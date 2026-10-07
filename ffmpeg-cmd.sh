#!/bin/sh
DURATION=$1
EXPORT_NAME=$2
DISPLAY_NUMBER=$3

# These default to the paths baked into the Docker image, but can be
# overridden (e.g. by a local, non-Docker worker) via environment variables.
PROCESSING_DIR="${PROCESSING_DIR:-/usr/src/app/processing}"
PROCESSED_DIR="${PROCESSED_DIR:-/usr/src/app/processed}"
PROGRESS_FILE="${PROGRESS_FILE:-/tmp/ffmpeg-progress-$EXPORT_NAME.txt}"

mkdir -p "$PROCESSING_DIR" "$PROCESSED_DIR"

echo "STAGE:{\"stage\":\"ffmpeg-start\",\"duration\":$DURATION,\"exportName\":\"$EXPORT_NAME\"}"

#Record the BBB playback, playing in Google browser in xvfb virtual screen, as MP4 video
# -progress emits machine readable key=value lines (out_time_ms, progress=continue/end)
# to stdout so a wrapping process (web dashboard, systemd, etc.) can compute
# a real-time percentage without guessing from wall-clock time alone.
ffmpeg -y -nostats -draw_mouse 0 -s 1280x800 \
	-framerate 30 \
	-f x11grab -thread_queue_size 1024 \
	-i :$DISPLAY_NUMBER \
	-f alsa -thread_queue_size 1024 \
	-itsoffset 0.57 \
	-i pulse -ac 2 \
	-c:v libx264 -c:a aac  \
	-crf 22  \
	-pix_fmt yuv420p \
	-preset fast \
	-movflags faststart \
	-t $DURATION \
	-progress pipe:1 \
	"$PROCESSING_DIR/$EXPORT_NAME.mp4"

FFMPEG_EXIT=$?
echo "STAGE:{\"stage\":\"ffmpeg-exit\",\"exitCode\":$FFMPEG_EXIT}"

if [ $FFMPEG_EXIT -ne 0 ]; then
	echo "ffmpeg exited with code $FFMPEG_EXIT" 1>&2
	exit $FFMPEG_EXIT
fi

# move the video to the processed folder
echo "STAGE:{\"stage\":\"moving-file\"}"
echo "Moving video to processed folder"
mv "$PROCESSING_DIR/$EXPORT_NAME.mp4" "$PROCESSED_DIR/$EXPORT_NAME.mp4"
echo "STAGE:{\"stage\":\"moved\",\"file\":\"$EXPORT_NAME.mp4\"}"
