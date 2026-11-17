import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getGeminiClient } from './ai/brain.ts';
import type { SpeakingSpeed, TtsVoice, VoiceStyle } from './types.ts';

const execFileAsync = promisify(execFile);

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

function resolveFontPath(): string | null {
  for (const p of FONT_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface MediaProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  sizeBytes: number;
}

export async function probeMediaFile(filePath: string): Promise<MediaProbeInfo> {
  const stat = fs.statSync(filePath);
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height',
    '-of',
    'json',
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }>;
  };

  const streams = parsed.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const durationSec = parsed.format?.duration ? Number(parsed.format.duration) : 0;

  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    videoCodec: videoStream?.codec_name || '',
    audioCodec: audioStream?.codec_name || '',
    sizeBytes: stat.size,
  };
}

export async function transcribeAudioBuffer(
  buffer: Buffer,
  mimeType: string = 'audio/ogg'
): Promise<string> {
  if (!buffer || buffer.length < 32) {
    throw new Error('Audio fayl juda kichik yoki bo‘sh.');
  }
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: buffer.toString('base64'),
          },
        },
        {
          text: 'Transcribe this speech accurately in its original language and script (supports Uzbek Latin, Uzbek Cyrillic, Russian, and English). Preserve names and numbers accurately. If audio is silent or unintelligible, return "[silent]". Return only the transcript.',
        },
      ],
    },
  });

  const text = (response.text || '').trim();
  return text === '[silent]' ? '' : text;
}

function buildSpeechStyleDirective(voiceStyle: VoiceStyle, speed: SpeakingSpeed): string {
  const toneMap: Record<VoiceStyle, string> = {
    calm: 'Calm, poised, crystal-clear personal assistant',
    warm: 'Warm, friendly, approachable personal assistant',
    energetic: 'Energetic, crisp, confident assistant',
    formal: 'Formal, respectful, executive assistant',
  };
  const speedMap: Record<SpeakingSpeed, string> = {
    slow: 'measured unhurried pace',
    normal: 'natural conversational pace',
    fast: 'brisk concise pace',
  };
  return `${toneMap[voiceStyle]} with ${speedMap[speed]}`;
}

export async function synthesizeVoiceNote(
  text: string,
  voiceName: TtsVoice = 'Kore',
  voiceStyle: VoiceStyle = 'calm',
  speakingSpeed: SpeakingSpeed = 'normal'
): Promise<{ wavBuffer: Buffer; oggBuffer: Buffer; durationSec: number }> {
  const ai = getGeminiClient();
  const cleanText = text.trim().slice(0, 2800);
  if (!cleanText) {
    throw new Error('TTS uchun matn bo‘sh.');
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: cleanText,
            speechMetadata: { style: buildSpeechStyleDirective(voiceStyle, speakingSpeed) },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Gemini TTS audio ma’lumotini qaytarmadi.');
  }

  const wavBuffer = Buffer.from(base64Audio, 'base64');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnia_tts_'));
  const wavPath = path.join(tmpDir, 'speech.wav');
  const oggPath = path.join(tmpDir, 'speech.ogg');

  try {
    fs.writeFileSync(wavPath, wavBuffer);
    const probe = await probeMediaFile(wavPath);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      wavPath,
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-vbr',
      'on',
      oggPath,
    ]);
    const oggBuffer = fs.readFileSync(oggPath);
    if (oggBuffer.length < 64) {
      throw new Error('OGG/OPUS konvertatsiyasi bo‘sh natija qaytardi.');
    }
    return {
      wavBuffer,
      oggBuffer,
      durationSec: Math.max(1, Math.round(probe.durationSec)),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export interface AnalyzedVideoContext {
  frames: Array<{ mimeType: 'image/jpeg'; buffer: Buffer; label: string }>;
  transcript: string;
  probe: MediaProbeInfo;
  summaryContext: string;
}

export async function analyzeVideoWithFfmpeg(params: {
  videoBuffer: Buffer;
  isVideoNote: boolean;
  caption?: string;
}): Promise<AnalyzedVideoContext> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnia_vid_in_'));
  const inputPath = path.join(tmpDir, 'input.mp4');

  try {
    fs.writeFileSync(inputPath, params.videoBuffer);
    const probe = await probeMediaFile(inputPath);

    // Extract up to 5 representative keyframes across the duration
    const frameCount = Math.max(1, Math.min(5, probe.durationSec > 10 ? 5 : 3));
    const fpsExpr = probe.durationSec > 1 ? `${frameCount}/${Math.max(1, probe.durationSec).toFixed(2)}` : '1';
    const framePattern = path.join(tmpDir, 'frame_%02d.jpg');

    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vf',
      `fps=${fpsExpr},scale=640:-2`,
      '-frames:v',
      String(frameCount),
      '-q:v',
      '3',
      framePattern,
    ]);

    const frames: Array<{ mimeType: 'image/jpeg'; buffer: Buffer; label: string }> = [];
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort();

    for (let i = 0; i < files.length; i++) {
      const buf = fs.readFileSync(path.join(tmpDir, files[i]));
      if (buf.length > 0) {
        frames.push({
          mimeType: 'image/jpeg',
          buffer: buf,
          label: `${params.isVideoNote ? 'video_note' : 'video'} frame ${i + 1}`,
        });
      }
    }

    // Extract audio track if present and run speech transcription
    let transcript = '';
    if (probe.hasAudio) {
      const audioPath = path.join(tmpDir, 'audio.ogg');
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-c:a',
        'libopus',
        '-b:a',
        '24k',
        '-ac',
        '1',
        audioPath,
      ]).catch(() => {});

      if (fs.existsSync(audioPath)) {
        const audioBuf = fs.readFileSync(audioPath);
        if (audioBuf.length > 200) {
          transcript = await transcribeAudioBuffer(audioBuf, 'audio/ogg').catch(() => '');
        }
      }
    }

    const summaryContext = [
      `[${params.isVideoNote ? 'Dumaloq video (Video Note)' : 'Video'} tahlili]`,
      `Texnik parametrlar: ${probe.width}x${probe.height}, davomiyligi ~${probe.durationSec.toFixed(1)}s, audio=${
        probe.hasAudio ? 'mavjud' : 'yo‘q'
      }.`,
      transcript ? `Videodan ajratib olingan nutq (STT):\n"${transcript}"` : 'Videoda aniq nutq aniqlanmadi.',
      params.caption ? `Foydalanuvchi izohi/savoli:\n${params.caption}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return { frames, transcript, probe, summaryContext };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function renderRoundVideoFromAudioFile(params: {
  wavPath: string;
  outputMp4Path: string;
  labelText?: string;
}): Promise<MediaProbeInfo> {
  const audioProbe = await probeMediaFile(params.wavPath);
  const targetDur = Math.max(1.2, Math.min(59, audioProbe.durationSec || 2));
  const fontPath = resolveFontPath();
  const safeLabel = (params.labelText || 'OMNIA AI').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 24) || 'OMNIA AI';

  const drawTextChain = fontPath
    ? `,drawtext=fontfile='${fontPath}':text='${safeLabel}':fontcolor=0xF5F2EB:fontsize=24:x=(w-text_w)/2:y=72,drawtext=fontfile='${fontPath}':text='AI VOICE AVATAR':fontcolor=0xD4AF37:fontsize=14:x=(w-text_w)/2:y=104`
    : '';

  // Emerald-graphite animated background + synchronized audio waveform ring-center + yuv420p square 384x384 H.264 + AAC
  const filterComplex = [
    `color=c=0x0B1612:s=384x384:r=25:d=${targetDur.toFixed(2)}[bg]`,
    `[0:a]aformat=channel_layouts=mono,showwaves=s=320x120:mode=cline:rate=25:colors=0x10B981|0xD4AF37[waves]`,
    `[bg][waves]overlay=x=(W-w)/2:y=(H-h)/2+28:shortest=1${drawTextChain},format=yuv420p[vout]`,
  ].join(';');

  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    params.wavPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '0:a',
    '-t',
    targetDur.toFixed(2),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    params.outputMp4Path,
  ]);

  const outProbe = await probeMediaFile(params.outputMp4Path);
  if (!outProbe.hasVideo || !outProbe.hasAudio || outProbe.width !== 384 || outProbe.height !== 384) {
    throw new Error(
      `Yaratilgan video_note talabga javob bermadi (${outProbe.width}x${outProbe.height}, video=${outProbe.hasVideo}, audio=${outProbe.hasAudio}).`
    );
  }
  if (outProbe.durationSec > 60) {
    throw new Error(`Yaratilgan video_note 60s limitidan oshdi (${outProbe.durationSec}s).`);
  }
  return outProbe;
}

export async function generateRoundVideoNote(params: {
  text: string;
  ttsVoice?: TtsVoice;
  voiceStyle?: VoiceStyle;
  speakingSpeed?: SpeakingSpeed;
}): Promise<{ mp4Buffer: Buffer; durationSec: number; probe: MediaProbeInfo }> {
  const { wavBuffer } = await synthesizeVoiceNote(
    params.text,
    params.ttsVoice || 'Kore',
    params.voiceStyle || 'calm',
    params.speakingSpeed || 'normal'
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnia_vnote_out_'));
  const wavPath = path.join(tmpDir, 'voice.wav');
  const mp4Path = path.join(tmpDir, 'round_note.mp4');

  try {
    fs.writeFileSync(wavPath, wavBuffer);
    const probe = await renderRoundVideoFromAudioFile({
      wavPath,
      outputMp4Path: mp4Path,
      labelText: 'OMNIA AI',
    });
    const mp4Buffer = fs.readFileSync(mp4Path);
    if (mp4Buffer.length > 12 * 1024 * 1024) {
      throw new Error('Round video_note 12 MB limitidan katta.');
    }
    return {
      mp4Buffer,
      durationSec: Math.max(1, Math.min(60, Math.round(probe.durationSec))),
      probe,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
