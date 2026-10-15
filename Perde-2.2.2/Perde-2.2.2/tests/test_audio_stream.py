from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
import soundfile as sf
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'vocal-service'))
from audio_stream import process_wav


class StreamingTests(unittest.TestCase):
    def test_sample_exact_identity_at_all_seam_boundaries(self):
        # Includes sub-overlap recordings, exact block/stride ends and final tails.
        for frames in (1, 19, 20, 21, 279, 280, 281, 299, 300, 301, 560, 561, 599, 601, 997):
            with self.subTest(frames=frames), tempfile.TemporaryDirectory() as tmp:
                tmp=Path(tmp)
                rng=np.random.default_rng(42)
                data=rng.uniform(-.7,.7,(frames,2)).astype('float32')
                sf.write(tmp/'in.wav',data,10,subtype='FLOAT')
                progress=[]
                process_wav(tmp/'in.wav',tmp/'out.wav',lambda *args:lambda x:x,lambda d,t,s:progress.append(d))
                result,sr=sf.read(tmp/'out.wav')
                self.assertEqual(result.shape,data.shape)
                self.assertTrue(np.allclose(result,data,atol=1/32768+1e-7))
                self.assertEqual(progress,sorted(progress))
                self.assertEqual(progress[-1],frames)

    def test_40_minutes_never_reaches_transform_as_a_whole(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);sr=8000;total=40*60*sr
            second=np.column_stack([np.sin(np.arange(sr)*.17)*.2,np.cos(np.arange(sr)*.23)*.2]).astype('float32')
            with sf.SoundFile(str(tmp/'in.wav'),'w',samplerate=sr,channels=2,subtype='PCM_16') as stream:
                for _ in range(40*60):stream.write(second)
            largest=0;blocks=0
            def identity(block):
                nonlocal largest,blocks
                largest=max(largest,len(block));blocks+=1
                return block
            frames,rate=process_wav(tmp/'in.wav',tmp/'out.wav',lambda *args:identity)
            self.assertEqual((frames,rate),(total,sr))
            self.assertLessEqual(largest,30*sr)
            self.assertGreater(blocks,80)
            # Compare in bounded chunks too; input/output positions must match.
            with sf.SoundFile(str(tmp/'in.wav')) as a,sf.SoundFile(str(tmp/'out.wav')) as b:
                for block in a.blocks(blocksize=32768):
                    self.assertTrue(np.allclose(block,b.read(len(block)),atol=1/32768+1e-7))

    def test_rejects_wrong_length_nonfinite_and_empty_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);sf.write(tmp/'in.wav',np.ones((300,2))*.2,10)
            for transform in (lambda x:x[:-1],lambda x:np.full_like(x,np.nan)):
                with self.assertRaises(ValueError):process_wav(tmp/'in.wav',tmp/'out.wav',lambda *args:transform)
            sf.write(tmp/'in.wav',np.empty((0,2)),10)
            with self.assertRaises(ValueError):process_wav(tmp/'in.wav',tmp/'out.wav',lambda *args:lambda x:x)


if __name__=='__main__':unittest.main(verbosity=2)
