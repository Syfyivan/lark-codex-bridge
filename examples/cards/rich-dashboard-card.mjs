#!/usr/bin/env node

const data = {
  title: 'NOVA 控制中枢 · 全域监控台',
  summary: 'NOVA 控制中枢 · 全域监控台（示例数据）',
  subtitle: '系统全域实时监控 · 零延迟响应',
  description: '128 个节点在线，7x24 小时无人值守巡检',
  health: '99.98%',
  healthDelta: '+0.06%',
  status: '全部正常',
  pie: [
    { name: '移动端', value: 45 },
    { name: '桌面端', value: 35 },
    { name: 'API 直连', value: 20 },
  ],
  latency: [
    { region: '华东', latency: 38 },
    { region: '华北', latency: 45 },
    { region: '华南', latency: 41 },
    { region: '海外', latency: 76 },
  ],
  insights: [
    '海外节点延迟明显高于其他地域，建议评估就近节点或 CDN 加速覆盖。',
    '移动端占比接近半数，客户端侧性能优化优先级最高。',
  ],
};

let nextId = 1;
const id = () => `_${nextId++}`;

const pixels = (value) => ({ type: 'pixels', value });
const spacing = (top, right, bottom, left) => ({
  top: pixels(top),
  right: pixels(right),
  bottom: pixels(bottom),
  left: pixels(left),
});

function plainText(content, style = {}) {
  return {
    id: id(),
    tag: 'plain_text',
    property: {
      content,
      lines: 0,
      textAlign: 'left',
      textStyle: {
        attributes: style.bold ? ['bold'] : [],
        ...(style.color ? { color: style.color } : {}),
      },
    },
  };
}

function markdown(content, options = {}) {
  return {
    id: id(),
    tag: 'markdown',
    property: {
      elements: [plainText(content, options)],
      markdownElements: [],
      originTag: 'markdown',
      textAlign: 'left',
      textStyle: {
        attributes: options.bold ? ['bold'] : [],
        size: options.size ?? 'normal',
        platformSize: {
          pc: options.size ?? 'normal',
          mobile: options.size ?? 'normal',
        },
      },
      ...(options.margin ? { margin: options.margin } : {}),
    },
  };
}

function metricColumn({ label, value, detail, backgroundStyle, weight = 1 }) {
  return {
    id: id(),
    tag: 'column',
    property: {
      actions: [],
      backgroundStyle,
      direction: 'vertical',
      disabled: false,
      elements: [
        markdown(label, { color: 'grey', size: 'notation' }),
        markdown(detail ? `${value}  ${detail}` : value, { bold: true, size: 'heading-2' }),
      ],
      horizontalAlign: 'left',
      horizontalSpacingValue: pixels(8),
      padding: spacing(14, 16, 14, 16),
      verticalAlign: 'top',
      verticalSpacingValue: pixels(6),
      weight,
      width: 'weighted',
      widthValue: { type: 'column_width_weighted', value: weight },
    },
  };
}

function chart({ type, data: values, xField, yField, categoryField, valueField }) {
  return {
    id: id(),
    tag: 'chart',
    property: {
      chartSpec: {
        type,
        data: { values },
        label: { visible: true },
        ...(type === 'pie'
          ? { categoryField, valueField }
          : {
              xField,
              yField,
              axes: [{ orient: 'left', title: { text: 'ms', visible: true } }],
            }),
      },
      colorTheme: 'rainbow',
      heightValue: { type: 'builtin_chart_height', value: 'auto' },
      margin: spacing(8, 20, 0, 20),
      minLibVersion: '1.0.0',
      preview: true,
    },
  };
}

function actionButton({ text, actionID, value = {}, iconToken, confirm }) {
  return {
    id: id(),
    tag: 'button',
    property: {
      actionType: 'multi',
      actions: [
        {
          type: 'action_request',
          action: {
            actionID,
            isValueObjectType: true,
            value,
          },
        },
      ],
      disabled: false,
      icon: iconToken
        ? {
            id: id(),
            tag: 'standard_icon',
            property: { token: iconToken, color: 'violet' },
          }
        : undefined,
      margin: spacing(8, 20, 0, 20),
      text: plainText(text),
      type: 'default',
      widthValue: { type: 'builtin_width', value: 'fill' },
      ...(confirm ? { confirm } : {}),
    },
  };
}

function createCard() {
  const reportActionID = 'generate_report';
  const subscribeActionID = 'subscribe_daily_report';

  return {
    schema: '2.0',
    source: 'json',
    config: {
      enableForwardInteraction: false,
      streamingMode: false,
      summary: { content: data.summary },
    },
    header: {
      id: id(),
      tag: 'card_header',
      property: {
        template: 'carmine',
        title: plainText(data.title),
      },
    },
    body: {
      id: id(),
      tag: 'body',
      property: {
        direction: 'vertical',
        horizontalAlign: 'left',
        horizontalSpacingValue: pixels(8),
        padding: spacing(0, 0, 16, 0),
        verticalAlign: 'top',
        verticalSpacingValue: pixels(10),
        elements: [
          {
            id: id(),
            tag: 'interactive_container',
            property: {
              actions: [],
              backgroundStyle: 'grey-950',
              cornerRadiusValue: pixels(12),
              direction: 'vertical',
              disabled: false,
              elements: [
                markdown(data.subtitle, { bold: true, color: 'turquoise', size: 'heading-2' }),
                markdown(data.description, { color: 'white' }),
              ],
              hasBorder: false,
              heightValue: { type: 'builtin_interactive_container_height', value: 'auto' },
              horizontalAlign: 'left',
              horizontalSpacingValue: pixels(8),
              margin: spacing(0, 20, 0, 20),
              padding: spacing(18, 20, 18, 20),
              verticalAlign: 'top',
              verticalSpacingValue: pixels(6),
              widthValue: { type: 'builtin_interactive_container_width', value: 'fill' },
            },
          },
          {
            id: id(),
            tag: 'column_set',
            property: {
              actions: [],
              backgroundStyle: 'default',
              columns: [
                metricColumn({
                  label: '系统健康度',
                  value: data.health,
                  detail: `${data.healthDelta} 较上周`,
                  backgroundStyle: 'indigo-50',
                  weight: 2,
                }),
                metricColumn({
                  label: '告警状态',
                  value: data.status,
                  backgroundStyle: 'green-50',
                  weight: 1,
                }),
              ],
              disabled: false,
              flexMode: 'stretch',
              horizontalAlign: 'left',
              horizontalSpacingValue: pixels(8),
              margin: spacing(0, 20, 0, 20),
              verticalAlign: 'top',
            },
          },
          markdown('请求来源构成（示例数据）', {
            bold: true,
            size: 'heading-3',
            margin: spacing(8, 20, 0, 20),
          }),
          chart({
            type: 'pie',
            data: data.pie,
            categoryField: 'name',
            valueField: 'value',
          }),
          markdown('各地域响应时长对比（示例数据）', {
            bold: true,
            size: 'heading-3',
            margin: spacing(12, 20, 0, 20),
          }),
          chart({
            type: 'bar',
            data: data.latency,
            xField: 'region',
            yField: 'latency',
          }),
          markdown(`核心洞察（示例数据）\n${data.insights.map((item) => `- ${item}`).join('\n')}`, {
            margin: spacing(12, 20, 0, 20),
          }),
          {
            id: id(),
            tag: 'form',
            property: {
              name: 'Form_console_view',
              direction: 'vertical',
              elements: [
                markdown('生成自定义视图\n选择监控视图和起始日期，生成对应的示例报表。'),
                {
                  id: id(),
                  tag: 'select_static',
                  property: {
                    actions: [],
                    disabled: false,
                    initialIndex: -1,
                    margin: spacing(8, 0, 0, 0),
                    name: 'view_scope',
                    options: [
                      { text: plainText('全域视图'), value: 'global', disabled: false, actions: [] },
                      { text: plainText('华东视图'), value: 'east_china', disabled: false, actions: [] },
                      { text: plainText('华北视图'), value: 'north_china', disabled: false, actions: [] },
                    ],
                    placeholder: plainText('选择监控视图'),
                    required: true,
                  },
                },
                {
                  id: id(),
                  tag: 'date_picker',
                  property: {
                    actions: [],
                    disabled: false,
                    margin: spacing(8, 0, 0, 0),
                    name: 'start_date',
                    placeholder: plainText('选择起始日期'),
                    required: true,
                  },
                },
                actionButton({
                  text: '生成对应报表',
                  actionID: reportActionID,
                  value: { action: 'generate_report' },
                }),
              ],
              margin: spacing(12, 20, 0, 20),
              submit: {
                actionID: reportActionID,
                value: { action: 'generate_report' },
              },
            },
          },
          {
            id: id(),
            tag: 'interactive_container',
            property: {
              actions: [
                {
                  type: 'open_url',
                  action: { url: 'https://open.feishu.cn/document/feishu-cards/card-json-v2-structure' },
                },
              ],
              backgroundStyle: 'grey-50',
              direction: 'vertical',
              disabled: false,
              elements: [
                markdown('查看飞书卡片开发文档', { bold: true }),
                markdown('了解本卡片使用的组件、行为与主题能力。', { color: 'grey' }),
              ],
              hasBorder: false,
              margin: spacing(12, 20, 0, 20),
              padding: spacing(14, 16, 14, 16),
              widthValue: { type: 'builtin_interactive_container_width', value: 'fill' },
            },
          },
          actionButton({
            text: '订阅每日战报',
            actionID: subscribeActionID,
            value: { action: 'subscribe_daily_report' },
            iconToken: 'send_filled',
            confirm: {
              title: plainText('确认订阅每日战报？'),
              text: plainText('订阅后每天 09:00 推送全域监控摘要（示例交互）。'),
            },
          }),
          {
            id: id(),
            tag: 'interactive_container',
            property: {
              actions: [],
              backgroundStyle: 'default',
              direction: 'vertical',
              disabled: false,
              elements: [markdown('本卡片全部指标均为示例数据，可替换为真实监控、任务、日报或活动数据。')],
              hasBorder: false,
              margin: spacing(12, 20, 0, 20),
              padding: spacing(12, 16, 12, 16),
              widthValue: { type: 'builtin_interactive_container_width', value: 'fill' },
            },
          },
        ],
      },
    },
  };
}

console.log(JSON.stringify(createCard(), null, 2));
