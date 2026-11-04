"""
Assemble the demo video from GENUINE footage (Playwright recording of the live app),
designed cards, the Gemini TTS voiceover and burned-in captions.

Usage (from the app root):  python -I scripts/video/assemble.py
Outputs: .capture/out/FINAL_DEMO.mp4, .capture/out/FINAL_VOICEOVER.wav, .capture/out/captions.srt
"""
import json, os, re, subprocess, sys

ROOT = os.getcwd()
CAP = os.path.join(ROOT, ".capture")
OUT = os.path.join(CAP, "out")
SEG = os.path.join(CAP, "seg")
os.makedirs(OUT, exist_ok=True)
os.makedirs(SEG, exist_ok=True)

W, H, FPS = 1920, 1080, 30
LEAD, TAIL = 0.45, 0.75          # silence before / after each narration line
PAPER = "0xF5F2EC"
VIDEO_OFFSET = 0.2               # recording starts ~0.2 s after the capture clock
MAX_SPEED = 2.0


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(" ".join(args)[:600]); print(r.stderr[-2000:]); sys.exit(1)
    return r.stdout


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip())


script = json.load(open(os.path.join(ROOT, "scripts/video/script.json"), encoding="utf8"))
timeline = {e["scene"]: e["t"] for e in json.load(open(os.path.join(CAP, "timeline.json"), encoding="utf8"))}
raw = os.path.join(CAP, "video", "demo-raw.webm")
raw_len = duration(raw)

segments, captions = [], []
clock = 0.0
for i, sc in enumerate(script["scenes"]):
    vo = os.path.join(CAP, "vo", f"{sc['id']}.wav")
    vo_len = duration(vo)
    target = LEAD + vo_len + TAIL
    seg = os.path.join(SEG, f"{i:02d}-{sc['id']}.mp4")
    badge = None

    if sc["type"] == "card":
        dur = target
        vf = (f"scale={W}:{H},format=yuv420p,fade=t=in:st=0:d=0.35:color={PAPER},"
              f"fade=t=out:st={dur-0.35:.3f}:d=0.35:color={PAPER}")
        vin = ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", os.path.join(CAP, "cards", f"{sc['card']}.png")]
    else:
        start = max(0.0, timeline[sc["from"]] - VIDEO_OFFSET)
        end = min(raw_len, timeline[sc["to"]] - VIDEO_OFFSET)
        span = end - start
        speed = 1.0
        if span > target:
            speed = min(MAX_SPEED, span / target)
        played = span / speed
        freeze = max(0.0, target - played)
        dur = played + freeze
        badge = "LIVE SANDBOX RECORDING" + (f"  ·  {speed:.1f}× SPEED" if speed > 1.05 else "")
        vf = (f"trim=start={start:.3f}:end={end:.3f},setpts=(PTS-STARTPTS)/{speed:.4f},fps={FPS},"
              f"scale={W}:{H}:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration={freeze:.3f},"
              f"fade=t=in:st=0:d=0.3:color={PAPER},fade=t=out:st={dur-0.3:.3f}:d=0.3:color={PAPER}")
        vin = ["-i", raw]

    af = f"adelay={int(LEAD*1000)}|{int(LEAD*1000)},apad,atrim=0:{dur:.3f},aresample=48000,aformat=channel_layouts=stereo"
    run(["ffmpeg", "-y", "-v", "error", *vin, "-i", vo,
         "-filter_complex", f"[0:v]{vf}[v];[1:a]{af}[a]", "-map", "[v]", "-map", "[a]",
         "-t", f"{dur:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-c:a", "pcm_s16le", seg])
    segments.append(seg)

    # Captions: split narration into sentences, time them proportionally to length.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", sc["vo"]) if s.strip()]
    total_chars = sum(len(s) for s in sentences)
    t = clock + LEAD
    for s in sentences:
        d = vo_len * len(s) / total_chars
        captions.append((t, t + d, s))
        t += d
    if badge:
        captions.append((clock + 0.2, clock + dur - 0.2, "BADGE:" + badge))
    print(f"{sc['id']:<18} {dur:6.2f}s  (vo {vo_len:5.2f}s){'  ' + badge if badge else ''}")
    clock += dur

print(f"TOTAL {clock:.2f}s")
if clock >= 179:
    sys.exit("Video would exceed 3 minutes")

# Concatenate segments.
listfile = os.path.join(SEG, "list.txt")
with open(listfile, "w", encoding="utf8") as f:
    for s in segments:
        f.write(f"file '{s.replace(os.sep, '/')}'\n")
joined = os.path.join(SEG, "joined.mkv")
run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listfile, "-c", "copy", joined])


def ts_ass(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def ts_srt(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


ass = [
    "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cap,Segoe UI,40,&H00FFFFFF,&H00FFFFFF,&H00181B1C,&H64181B1C,0,0,0,0,100,100,0,0,3,14,0,2,260,260,54,1",
    "Style: Badge,Segoe UI Semibold,22,&H00FFFFFF,&H00FFFFFF,&H004A5F1F,&H004A5F1F,1,0,0,0,100,100,1.5,0,3,9,0,8,40,40,26,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
]
srt, n = [], 0
for a, b, text in captions:
    if text.startswith("BADGE:"):
        ass.append(f"Dialogue: 1,{ts_ass(a)},{ts_ass(b)},Badge,,0,0,0,,● {text[6:]}")
    else:
        ass.append(f"Dialogue: 0,{ts_ass(a)},{ts_ass(b)},Cap,,0,0,0,,{text}")
        n += 1
        srt += [str(n), f"{ts_srt(a)} --> {ts_srt(b)}", text, ""]
open(os.path.join(SEG, "subs.ass"), "w", encoding="utf8").write("\n".join(ass) + "\n")
open(os.path.join(OUT, "captions.srt"), "w", encoding="utf8").write("\n".join(srt))

# Burn captions, encode final (cwd = seg so the subtitles path needs no escaping).
final = os.path.join(OUT, "FINAL_DEMO.mp4")
cwd = os.getcwd(); os.chdir(SEG)
run(["ffmpeg", "-y", "-v", "error", "-i", "joined.mkv", "-vf", "subtitles=subs.ass",
     "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
     "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final])
os.chdir(cwd)
run(["ffmpeg", "-y", "-v", "error", "-i", final, "-vn", "-ac", "1", "-ar", "48000", os.path.join(OUT, "FINAL_VOICEOVER.wav")])
print("final duration", round(duration(final), 2), "s ->", final)
