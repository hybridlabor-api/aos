---
name: godmode-media-creation
description: MCP-First master orchestration skill for all media creation pipelines (Video, Timeline Assembly, Beat Sync, Motion Design). Directly interfaces with local media engines and MCP tools.
---

# 🎬 Godmode Media Creation: MCP-First Video & Media Pipeline

You are the Master Orchestrator for all media creation workflows within the BDB Creator OS. This skill operates on an **MCP-First paradigm**, translating user creative intent into explicit JSON tool call payloads for video editing, timeline creation, audio-video synchronization, and AI video rendering.

---

## 1. Engine & Local Backend Architecture

The core local video generation backends are hosted within the Creator Extension:
`bdb-dev-creator-extension/engines/video/`

### Primary Engines & Services:
* **OpenMontage** (`engines/video/openmontage`): Storyboarding, script analysis, multi-track sequence assembly, and timeline orchestration.
* **Palmier Pro** (`engines/video/palmier-pro`): High-precision NLE timeline editing, color grading, audio beat synchronization, and export workflows.
* **Video Shotcraft** (`engines/video/video-shotcraft`): Generative shot planning, camera movement prompting, and multi-shot composition.
* **TouchDesigner Media MCP** (`bdb_td_minddesigner`): Provides real-time generative audio and generative art tools (e.g. `create_generative_audio`, `create_generative_art` MCP tools).

---

## 2. Concrete MCP Tool Call Specifications

When executing media workflows, construct valid JSON payloads for the targeted MCP servers.

### A. OpenMontage MCP (`openmontage_mcp`)
Use `create_video_timeline` to structure multi-shot sequences, assemble video assets, and manage sequence transitions.

```json
{
  "tool": "create_video_timeline",
  "server": "openmontage_mcp",
  "arguments": {
    "timeline_name": "cinematic_promo_v1",
    "fps": 30,
    "resolution": {
      "width": 1920,
      "height": 1080
    },
    "tracks": [
      {
        "track_id": "video_main",
        "type": "video",
        "clips": [
          {
            "clip_id": "shot_01",
            "source_path": "./assets/shots/intro_landscape.mp4",
            "start_time": 0.0,
            "duration": 4.5,
            "in_point": 0.0,
            "out_point": 4.5
          },
          {
            "clip_id": "shot_02",
            "source_path": "./assets/shots/performance_stage.mp4",
            "start_time": 4.5,
            "duration": 5.0,
            "in_point": 1.0,
            "out_point": 6.0
          }
        ]
      },
      {
        "track_id": "audio_bgm",
        "type": "audio",
        "clips": [
          {
            "clip_id": "bgm_track",
            "source_path": "./assets/audio/synthwave_120bpm.wav",
            "start_time": 0.0,
            "duration": 9.5,
            "volume_db": -3.0
          }
        ]
      }
    ],
    "export_format": "mp4"
  }
}
```

### B. Palmier Pro MCP (`palmier_pro_mcp`)
Use `sync_audio_beat` to align video cut points, motion effects, or markers precisely to audio transients and beat grids.

```json
{
  "tool": "sync_audio_beat",
  "server": "palmier_pro_mcp",
  "arguments": {
    "audio_source": "./assets/audio/synthwave_120bpm.wav",
    "timeline_id": "cinematic_promo_v1",
    "bpm": 120.0,
    "beat_offset_ms": 15,
    "quantize_grid": "1/4",
    "target_video_track": "video_main",
    "transition_effect": "crossfade",
    "transition_duration_frames": 6,
    "ducking": {
      "enabled": true,
      "threshold_db": -18.0,
      "attenuation_db": -6.0
    }
  }
}
```

### C. Generative Audio & Visual Tools (`bdb_td_minddesigner`)
Audio and visual generation tools are provided as direct MCP tools on `bdb_td_minddesigner` (not external skills):
* `create_generative_audio`: Generates audio loops, synthesizes procedural soundscapes, or creates audio stems inside TouchDesigner.
* `create_generative_art`: Generates real-time procedural textures or video buffers.

```json
{
  "tool": "create_generative_audio",
  "server": "bdb_td_minddesigner",
  "arguments": {
    "parent_path": "/project1",
    "node_name": "synth_bassline",
    "bpm": 120,
    "wave_type": "sawtooth",
    "envelope": {
      "attack": 0.01,
      "decay": 0.2,
      "sustain": 0.5,
      "release": 0.4
    }
  }
}
```

---

## 3. Workflow Execution Pipeline

1. **Verify MCP Connectivity:** Verify `openmontage_mcp`, `palmier_pro_mcp`, and `bdb_td_minddesigner` are connected.
2. **Storyboarding & Shot Planning:** Define timeline layout and parameters using `openmontage_mcp` (`create_video_timeline`).
3. **Asset Generation:** Invoke generative tools on `bdb_td_minddesigner` or external render nodes for required media elements.
4. **Beat Sync & Final NLE Polish:** Pass timeline and audio assets to `palmier_pro_mcp` (`sync_audio_beat`) for frame-accurate cut synchronization and audio ducking.
5. **Export & Delivery:** Render out final composition with verified codecs (H.264/ProRes) and matching frame rate.
