#!/bin/sh
# Codex `notify` forwarder: lets one notify slot drive BOTH the existing
# Computer Use notifier AND the Kodama desktop pet.
#
# Wire up in ~/.codex/config.toml:
#   notify = ["/Users/bytedance/code/kodama/scripts/codex-notify.sh"]
#
# Codex calls this as:  codex-notify.sh <event-json>   (JSON in $1)
JSON="$1"

# 1) preserve the original Computer Use notifier (it expects: "turn-ended" <json>)
ORIG="/Users/bytedance/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
[ -x "$ORIG" ] && "$ORIG" "turn-ended" "$JSON" >/dev/null 2>&1 || true

# 2) notify the Kodama desktop pet (loopback; bypass any HTTP proxy)
curl -s -m 1 --noproxy 127.0.0.1 -X POST http://127.0.0.1:7766 \
  -H 'Content-Type: application/json' -d "$JSON" >/dev/null 2>&1 || true
