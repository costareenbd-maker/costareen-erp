#!/usr/bin/env python3
"""Speak a text with Microsoft Edge's neural voices (edge-tts) and write the word timings.
Usage: tts.py <text-file> <voice> <rate e.g. +0%> <out.mp3> <words.json>
The words file is [{"start": s, "end": s, "text": "..."}]. Exit code 0 on success."""
import asyncio, json, sys
import edge_tts

async def main():
    text = open(sys.argv[1], encoding='utf-8').read().strip()
    voice, rate, out, words_path = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
    try:
        c = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
    except TypeError:
        c = edge_tts.Communicate(text, voice, rate=rate)
    words = []
    with open(out, 'wb') as f:
        async for ch in c.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] in ('WordBoundary', 'SentenceBoundary'):
                words.append({'start': ch['offset'] / 1e7, 'end': (ch['offset'] + ch['duration']) / 1e7, 'text': ch['text']})
    with open(words_path, 'w', encoding='utf-8') as f:
        json.dump(words, f, ensure_ascii=False)

asyncio.run(main())
