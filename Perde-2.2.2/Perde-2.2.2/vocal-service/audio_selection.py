"""Prefer the actual Turkish audio track, using yt-dlp's sorted formats."""
import re


def base_language(value):
    if not isinstance(value, str):
        return 'und'
    base = value.strip().lower().replace('_', '-').split('-', 1)[0]
    if base in ('tr', 'tur'):
        return 'tr'
    return base if re.fullmatch('[a-z]{2,3}', base) else 'und'


def select_audio(formats):
    # yt-dlp sorts from worst to best, including original/default language
    # preference. Filter language before quality so an English original can
    # never outrank an available Turkish dub. Do not infer audio from subtitles.
    audio = [fmt for fmt in formats if fmt.get('vcodec') == 'none'
             and fmt.get('acodec') not in (None, 'none') and not fmt.get('has_drm')]
    if not audio:
        raise ValueError('İndirilebilir bir ses parçasına ulaşılamadı.')
    turkish = [fmt for fmt in audio if base_language(fmt.get('language')) == 'tr']
    if turkish:
        ordinary = [fmt for fmt in turkish if fmt.get('language_preference') != -10
                    and 'desc' not in str(fmt.get('language', '')).lower().replace('_', '-').split('-')[1:]]
        selected = (ordinary or turkish)[-1]
    else:
        selected = audio[-1]
    return selected, {
        'audioLanguage': base_language(selected.get('language')),
        'audioSelection': 'turkish' if turkish else 'fallback',
    }
