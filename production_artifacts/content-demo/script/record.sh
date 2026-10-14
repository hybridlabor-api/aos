#!/usr/bin/env bash
set -euo pipefail

# record.sh — screen recording helper for agenttrail board demo
# Subcommands: check, list-devices, start, crop916, trim

PROGNAME="$(basename "$0")"

die() {
  echo "error: $*" >&2
  exit 1
}

print_cmd() {
  echo "+ $*" >&2
  "$@"
}

cmd_check() {
  echo "Checking dependencies..." >&2
  local missing=()

  if ! command -v ffmpeg &>/dev/null; then
    missing+=("ffmpeg")
  fi
  if ! command -v node &>/dev/null; then
    missing+=("node")
  fi
  if ! command -v aos-trail &>/dev/null; then
    missing+=("aos-trail")
  fi
  if ! [[ -f driver.mjs ]]; then
    missing+=("driver.mjs (not found in current dir)")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing: ${missing[*]}" >&2
    return 1
  fi

  echo "All dependencies OK" >&2
  return 0
}

cmd_list_devices() {
  echo "Listing ffmpeg avfoundation devices..." >&2
  print_cmd ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true
}

cmd_start() {
  local device_idx="${1:-}"
  local duration="${2:-46}"

  [[ -n "$device_idx" ]] || die "start: requires <device-index> [seconds]"
  [[ "$duration" =~ ^[0-9]+$ ]] || die "start: duration must be a number"

  local timestamp
  timestamp=$(date +%Y-%m-%d-%H%M%S)
  local outfile="pulse-demo-${timestamp}.mp4"

  if [[ -f "$outfile" ]]; then
    die "start: output file already exists: $outfile"
  fi

  echo "Recording $duration seconds to $outfile..." >&2
  print_cmd ffmpeg -f avfoundation -framerate 30 -capture_cursor 1 \
    -i "${device_idx}:none" -t "$duration" -c:v libx264 \
    -preset veryfast -crf 20 -pix_fmt yuv420p "$outfile"

  echo "Recording saved: $outfile" >&2
}

cmd_crop916() {
  local infile="${1:-}"
  local outfile="${2:-}"

  [[ -n "$infile" ]] || die "crop916: requires <in> <out>"
  [[ -n "$outfile" ]] || die "crop916: requires <in> <out>"
  [[ -f "$infile" ]] || die "crop916: input file not found: $infile"

  if [[ -f "$outfile" ]]; then
    die "crop916: output file already exists: $outfile"
  fi

  echo "Cropping 16:9 (1920x1080) to 9:16 (1080x1920) center..." >&2
  print_cmd ffmpeg -i "$infile" \
    -vf "crop=1080:1920:(1920-1080)/2:0" \
    -c:v libx264 -preset veryfast -crf 20 "$outfile"

  echo "Cropped video saved: $outfile" >&2
}

cmd_trim() {
  local infile="${1:-}"
  local start="${2:-}"
  local duration="${3:-}"
  local outfile="${4:-}"

  [[ -n "$infile" ]] || die "trim: requires <in> <start> <dur> <out>"
  [[ -n "$start" ]] || die "trim: requires <in> <start> <dur> <out>"
  [[ -n "$duration" ]] || die "trim: requires <in> <start> <dur> <out>"
  [[ -n "$outfile" ]] || die "trim: requires <in> <start> <dur> <out>"
  [[ -f "$infile" ]] || die "trim: input file not found: $infile"

  if [[ -f "$outfile" ]]; then
    die "trim: output file already exists: $outfile"
  fi

  echo "Trimming from $start s for $duration s..." >&2
  print_cmd ffmpeg -i "$infile" \
    -ss "$start" -t "$duration" \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p "$outfile"

  echo "Trimmed video saved: $outfile" >&2
}

main() {
  local cmd="${1:-}"

  case "$cmd" in
    check)
      cmd_check
      ;;
    list-devices)
      cmd_list_devices
      ;;
    start)
      shift
      cmd_start "$@"
      ;;
    crop916)
      shift
      cmd_crop916 "$@"
      ;;
    trim)
      shift
      cmd_trim "$@"
      ;;
    *)
      cat >&2 <<EOF
Usage: $PROGNAME <subcommand> [args]

Subcommands:
  check                         Verify ffmpeg, node, aos-trail, driver.mjs
  list-devices                  List ffmpeg avfoundation capture devices
  start <idx> [seconds]         Record screen (default 46 s)
  crop916 <in> <out>            Crop 16:9 to 9:16 center (1920x1080 → 1080x1920)
  trim <in> <start> <dur> <out> Trim video (start time in s, duration in s)

Example:
  $PROGNAME check
  $PROGNAME list-devices
  $PROGNAME start 1 46
  $PROGNAME crop916 pulse-demo-2026-10-07.mp4 cropped.mp4
  $PROGNAME trim cropped.mp4 3 40 final.mp4
EOF
      exit 1
      ;;
  esac
}

main "$@"
