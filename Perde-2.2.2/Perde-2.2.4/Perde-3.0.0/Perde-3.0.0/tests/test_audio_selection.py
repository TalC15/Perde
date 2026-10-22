"""Language-selection regressions plus real yt-dlp downloads of synthetic audio."""
import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1] / 'vocal-service'
sys.path.insert(0, str(ROOT))
from audio_selection import select_audio
import worker


def audio(identifier, language=None, **values):
    return {'format_id': identifier, 'vcodec': 'none', 'acodec': 'aac',
            'language': language, **values}


class AudioSelectionTests(unittest.TestCase):
    def test_turkish_dub_overrides_higher_quality_original(self):
        formats = [audio('turkish', 'tr', abr=64), audio('original', 'en', abr=256)]
        chosen, metadata = select_audio(formats)
        self.assertEqual(chosen['format_id'], 'turkish')
        self.assertEqual(metadata, {'audioLanguage': 'tr', 'audioSelection': 'turkish'})

    def test_recognizes_turkish_regions_and_track_suffixes(self):
        for language in ('tr', 'TR', 'tur', 'TUR', 'tr-TR', 'tr_TR', 'tr-orig',
                         'tr-dubbed', 'tur-TR', ' tr '):
            with self.subTest(language=language):
                chosen, metadata = select_audio([audio('dub', language), audio('en', 'en')])
                self.assertEqual(chosen['format_id'], 'dub')
                self.assertEqual(metadata['audioLanguage'], 'tr')

    def test_selects_best_available_turkish_in_downloader_order(self):
        chosen, _ = select_audio([audio('tr-low', 'tr', abr=300),
                                 audio('tr-best', 'tr-TR', abr=128), audio('en', 'en')])
        self.assertEqual(chosen['format_id'], 'tr-best')

    def test_prefers_regular_turkish_over_audio_description(self):
        chosen, _ = select_audio([audio('regular', 'tr'), audio('description', 'tr-desc')])
        self.assertEqual(chosen['format_id'], 'regular')

    def test_description_language_preference_does_not_override_regular_turkish(self):
        chosen, _ = select_audio([audio('regular', 'tr', language_preference=-1),
                                 audio('description', 'tr', language_preference=-10)])
        self.assertEqual(chosen['format_id'], 'regular')

    def test_accepts_turkish_description_if_it_is_the_only_turkish_track(self):
        chosen, metadata = select_audio([audio('description', 'tr-desc'), audio('en', 'en')])
        self.assertEqual(chosen['format_id'], 'description')
        self.assertEqual(metadata['audioSelection'], 'turkish')

    def test_filters_video_drm_and_unusable_codec_tracks_before_language(self):
        formats = [audio('valid', 'en'), audio('video', 'tr', vcodec='avc1'),
                   audio('drm', 'tr', has_drm=True), audio('silent', 'tr', acodec='none'),
                   audio('missing-codec', 'tr', acodec=None)]
        chosen, metadata = select_audio(formats)
        self.assertEqual(chosen['format_id'], 'valid')
        self.assertEqual(metadata, {'audioLanguage': 'en', 'audioSelection': 'fallback'})

    def test_fallback_preserves_original_default_order(self):
        chosen, metadata = select_audio([audio('high-bitrate-french', 'fr', abr=256),
                                        audio('default-original', 'en-US', abr=64)])
        self.assertEqual(chosen['format_id'], 'default-original')
        self.assertEqual(metadata, {'audioLanguage': 'en', 'audioSelection': 'fallback'})

    def test_does_not_infer_turkish_from_display_notes(self):
        chosen, metadata = select_audio([audio('label-only', None, format_note='Turkish Türkçe'),
                                        audio('original', 'en', format_note='Turkish subtitles')])
        self.assertEqual(chosen['format_id'], 'original')
        self.assertEqual(metadata['audioSelection'], 'fallback')

    def test_unknown_and_malformed_language_report_und(self):
        for language in (None, '', 123, 'Türkçe', 'unknown', 'trick', 'turkish'):
            with self.subTest(language=language):
                _, metadata = select_audio([audio('track', language)])
                self.assertEqual(metadata, {'audioLanguage': 'und', 'audioSelection': 'fallback'})

    def test_no_audio_only_track_has_an_explanatory_failure(self):
        for formats in ([], [audio('muxed', 'tr', vcodec='avc1')],
                        [audio('drm', 'tr', has_drm=True)]):
            with self.subTest(formats=formats), self.assertRaisesRegex(ValueError, 'ses'):
                select_audio(formats)


class DownloaderIntegrationTests(unittest.TestCase):
    """Real yt-dlp and FFmpeg; the remote extractor and Demucs are fixtures."""
    @classmethod
    def setUpClass(cls):
        try:
            import yt_dlp
            import imageio_ffmpeg
            from yt_dlp.extractor.common import InfoExtractor
        except ImportError as exc:
            raise unittest.SkipTest('Run with vocal-service/.venv/Scripts/python.exe') from exc
        cls.yt_dlp = yt_dlp
        cls.base_downloader = yt_dlp.YoutubeDL
        cls.extractor_base = InfoExtractor
        if not Path(imageio_ffmpeg.get_ffmpeg_exe()).is_file():
            raise unittest.SkipTest('Bundled FFmpeg is unavailable')
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b''.join(struct.pack('<h', (index % 100 - 50) * 100)
                                       for index in range(2000)))
        cls.wav_bytes = stream.getvalue()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.requests = []
        self.broken = set()
        test = self
        class MediaHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                test.requests.append(self.path)
                if self.path in test.broken:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(test.wav_bytes)))
                self.end_headers()
                self.wfile.write(test.wav_bytes)
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), MediaHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temp.cleanup()

    def run_worker(self, languages):
        test = self
        extraction_count = 0
        selected_ids = []
        states = []
        class SyntheticYoutubeIE(self.extractor_base):
            _VALID_URL = r'https://www\.youtube\.com/watch\?v=(?P<id>[a-zA-Z0-9_-]{11})'
            def _real_extract(self, url):
                nonlocal extraction_count
                extraction_count += 1
                formats = []
                for index, language in enumerate(languages):
                    fmt = audio('track-' + str(index), language, ext='wav',
                                acodec='pcm_s16le', asr=8000, abr=128,
                                url=f'http://127.0.0.1:{test.http.server_port}/track-{index}.wav')
                    formats.append(fmt)
                return {'id': 'abcdefghijk', 'title': 'Synthetic multilingual audio',
                        'duration': .25, 'formats': formats,
                        # Turkish subtitles must never change an audio-only choice.
                        'subtitles': {'tr': [{'url': 'https://invalid.example/subtitle.vtt'}]}}
        class FixtureDownloader(self.base_downloader):
            def __init__(self, options):
                # Keep the real callable selector, download engine, and hooks.
                super().__init__(options, auto_init=False)
                self.add_info_extractor(SyntheticYoutubeIE(self))
            def download(self, *args, **kwargs):
                raise AssertionError('A second extraction via download() would change the audio snapshot')
            def extract_info(self, url, download=True, *args, **kwargs):
                test.assertTrue(download, 'Metadata and audio must use one extraction snapshot')
                result = super().extract_info(url, download=download, *args, **kwargs)
                selected_ids.append(result.get('format_id'))
                return result
        real_write_state = worker.write_state
        def capture_state(folder, state, error=None, **values):
            states.append({'state': state, **values})
            real_write_state(folder, state, error, **values)
        def separate_fixture(source, sink, device, engine, on_progress=None):
            import numpy as np
            with wave.open(str(source), 'rb') as recording:
                frames = recording.getnframes()
                rate = recording.getframerate()
                pcm = np.frombuffer(recording.readframes(frames), '<i2').reshape(-1, recording.getnchannels())
            sink.write(pcm.astype(np.float32) / 32768)
            if on_progress:
                on_progress(frames, frames, rate)
            return 'cpu'
        with patch.object(self.yt_dlp, 'YoutubeDL', FixtureDownloader), \
             patch.object(worker, 'write_state', capture_state), \
             patch.object(worker, 'separate', separate_fixture):
            metadata = worker.run(self.folder, 'abcdefghijk', 3, 'cpu')
        return metadata, extraction_count, selected_ids, states

    def test_real_download_selects_turkish_and_keeps_language_in_progress(self):
        metadata, extractions, selected_ids, states = self.run_worker(['tr', 'en'])
        self.assertEqual(metadata, {'audioLanguage': 'tr', 'audioSelection': 'turkish', 'totalSeconds': .25, 'device': 'cpu'})
        self.assertEqual(extractions, 1)
        self.assertEqual(selected_ids, ['track-0'])
        self.assertEqual(self.requests, ['/track-0.wav'])
        self.assertTrue((self.folder / 'vocals.mp3').is_file())
        self.assertTrue({'downloading', 'separating', 'encoding'} <= {state['state'] for state in states})
        for state in states:
            self.assertEqual(state['audioLanguage'], 'tr')
            self.assertEqual(state['audioSelection'], 'turkish')

    def test_real_download_without_turkish_uses_original_and_reports_fallback(self):
        metadata, extractions, selected_ids, states = self.run_worker(['en'])
        self.assertEqual(metadata, {'audioLanguage': 'en', 'audioSelection': 'fallback', 'totalSeconds': .25, 'device': 'cpu'})
        self.assertEqual(extractions, 1)
        self.assertEqual(selected_ids, ['track-0'])
        self.assertEqual(self.requests, ['/track-0.wav'])
        self.assertTrue(states)
        for state in states:
            self.assertEqual(state['audioSelection'], 'fallback')

    def test_turkish_download_failure_does_not_silently_download_original(self):
        self.broken.add('/track-0.wav')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(Exception):
            self.run_worker(['tr', 'en'])
        self.assertTrue(self.requests)
        self.assertTrue(all(path == '/track-0.wav' for path in self.requests))
        self.assertFalse((self.folder / 'vocals.mp3').exists())


if __name__ == '__main__':
    unittest.main()
