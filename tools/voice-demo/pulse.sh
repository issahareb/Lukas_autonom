#!/bin/sh
set -eu
umask 077
DEMO_RUNTIME=${DEMO_RUNTIME:-/tmp/lukas-voice-demo}
mkdir -p "$DEMO_RUNTIME"
chmod 700 "$DEMO_RUNTIME"
exec pulseaudio --daemonize=no --exit-idle-time=-1 --use-pid-file=no --disable-shm=yes -n \
 --load="module-native-protocol-unix socket=$DEMO_RUNTIME/pulse.sock auth-anonymous=1" \
 --load='module-null-sink sink_name=eva_out rate=48000 channels=1' \
 --load='module-null-sink sink_name=lukas_out rate=48000 channels=1' \
 --load='module-remap-source source_name=eva_mic master=lukas_out.monitor source_properties=device.description=Eva_Microphone'
