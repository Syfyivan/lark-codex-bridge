# Rich Dashboard Feishu Card

This directory contains a reusable Feishu Card JSON 2.0 example modeled after an information-dense dashboard card: summary header, KPI blocks, charts, insights, a form, a link block, and action buttons.

## Generate JSON

```bash
node examples/cards/rich-dashboard-card.mjs > /tmp/rich-dashboard-card.json
```

## Validate Locally

```bash
node examples/cards/rich-dashboard-card.mjs | jq -e '.schema == "2.0" and .body.property.elements | length > 0'
```

Preview the send request without sending:

```bash
CARD_JSON="$(node examples/cards/rich-dashboard-card.mjs)"
lark-cli im +messages-send \
  --chat-id oc_xxx \
  --msg-type interactive \
  --content "$CARD_JSON" \
  --dry-run
```

## Send

Only run this after replacing `oc_xxx` with the target chat and confirming the card content:

```bash
CARD_JSON="$(node examples/cards/rich-dashboard-card.mjs)"
lark-cli im +messages-send \
  --chat-id oc_xxx \
  --msg-type interactive \
  --content "$CARD_JSON"
```

## Customize

Edit the `data` object at the top of `rich-dashboard-card.mjs`:

- `title`, `summary`, `subtitle`, `description`
- `health`, `healthDelta`, `status`
- `pie` values for the source distribution chart
- `latency` values for the bar chart
- `insights`

For real callbacks, replace `generate_report` and `subscribe_daily_report` with action IDs handled by your Feishu bot's `card.action.trigger` event listener.
