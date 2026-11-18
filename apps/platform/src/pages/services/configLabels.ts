/**
 * 平台「服务配置中心」的字段中文名。
 *
 * 为什么单独抽一份：这一页是**按后端配置结构自动生成表单**的（5 个分类、嵌套
 * alipay/wechat/local/oss，手写 5 套表单维护成本太高），字段名只能来自数据 key。
 * 不翻译就等于把 `environment`、`privateKey` 这种程序字段直接甩给运营看。
 *
 * **词表与租户控制台 `src/pages/system/settings/*` 的字段名保持一致** ——
 * 运营在平台端和租户端看到的必须是一套说法，否则同一件事两个名字。
 *
 * 未登记的 key 会原样显示（显式暴露缺口，而不是静默变成空白）。
 */

/** 字段 → 中文名 */
export const CONFIG_FIELD_LABELS: Record<string, string> = {
  // ---- 通用 ----
  enabled: '启用',
  environment: '运行环境',
  notifyUrl: '异步通知地址',
  returnUrl: '同步返回地址',

  // ---- 支付：支付宝 ----
  appId: 'App ID',
  privateKey: '应用私钥',
  publicKey: '支付宝公钥',

  // ---- 支付：微信 ----
  mchId: '商户号',
  apiV3Key: 'API v3 密钥',
  serialNo: '证书序列号',

  // ---- 短信 ----
  provider: '服务商',
  accessKeyId: 'AccessKey ID',
  accessKeySecret: 'AccessKey Secret',
  region: '地域',
  signName: '短信签名',
  templateCode: '默认模板 Code',
  dailyLimit: '每日发送上限',

  // ---- 邮件 ----
  host: 'SMTP 主机',
  port: '端口',
  ssl: '使用 SSL',
  username: '登录账号',
  password: '授权码 / 密码',
  fromName: '发件人名称',
  fromAddress: '发件人地址',

  // ---- 存储 ----
  driver: '存储位置',
  uploadDir: '上传目录',
  publicBaseUrl: '公开访问地址',
  endpoint: 'Endpoint',
  bucket: 'Bucket',
  domain: '自定义域名',
  prefix: '路径前缀',

  // ---- 高德地图 ----
  jsKey: 'Web端(JS API) key',
  webKey: 'Web服务 key',
  securityCode: '安全密钥',
  defaultCenter: '默认中心点（经度,纬度）',
  defaultZoom: '默认缩放级别（3-18）',
  useProxy: '安全密钥走服务端代理',
};

/** 配置分组（嵌套对象）→ 中文名 */
export const CONFIG_GROUP_LABELS: Record<string, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
  local: '本地存储',
  oss: '阿里云 OSS',
  sms: '短信',
  email: '邮件',
  storage: '存储',
  amap: '高德地图',
  payment: '支付',
};

/** 字段的取值说明（只给运营真的会用错的那些） */
export const CONFIG_FIELD_HINTS: Record<string, string> = {
  environment: 'sandbox = 沙箱（测试）；production = 生产',
  driver: 'local = 本地磁盘；oss = 阿里云 OSS',
  provider: '短信：aliyun / tencent；邮件：qq / 163 / aliyun',
  defaultCenter: '格式：经度,纬度（如 116.397428,39.90923）',
  useProxy: '开启后密钥不出现在前端，由服务端代理请求',
  publicBaseUrl: '附件直链前缀，换域名要同步改这里',
};

/** 字段中文名（未登记则回落原始 key） */
export function configFieldLabel(key: string): string {
  return CONFIG_FIELD_LABELS[key] ?? key;
}

/** 分组中文名（未登记则回落原始 key） */
export function configGroupLabel(key: string): string {
  return CONFIG_GROUP_LABELS[key] ?? key;
}
