# 学迹 Android 测试工程

首个版本只做「账本 / 伙伴 / 我的」。复用桌面端整数分、导入预览、去重与账本交换规则，支持中日英；初华只在伙伴页活动。当前已实现手记、CSV / JSON 导入、预算、集中核对、JSON 备份分享和点击随机动作。没有通知采集、银行连接、自动同步或桌面悬浮权限。

## 构建

需要 Node 22+、JDK 21、Android SDK 36。工程已生成，不需要再次执行 `cap add`。

```sh
cd mobile
npm ci
npm run android:sync
cd android
./gradlew assembleDebug
```

Windows 使用 `gradlew.bat assembleDebug`。输出：`android/app/build/outputs/apk/debug/app-debug.apk`。也可以手动运行 GitHub Actions 的 **Android preview** 工作流，下载 `StudyTrail-Android-preview` artifact。构建不会创建 GitHub Release。

测试包包名为 `com.studytrail.mobile.preview`，与将来的正式版分开。CI 默认调试签名不保证各次构建一致，不能作为长期更新渠道；正式版前需由所有者保管固定签名密钥，不能要求用户卸载应用来更新并损失账目。

## 已验证和待验证

浏览器自动化验证 5 项：人民币精度与重启保存、桌面账本预览合并及重复导入、伙伴随机动作和页面反复切换、360px 三语言布局、独立账本导出。截图在仓库 `tools/_shots/mobile/`。

Android 原生文件选择、系统分享、系统栏、返回键、息屏 / 重启仍需 APK 和红米 K70 Pro 真机测试。首版使用独立 WebView 本地存储，卸载或清除应用数据会删除账目；正式版前应迁移至原生持久化并验证迁移和恢复。系统云备份默认关闭，主动导出账本不会带上桌面学习记录或 API 配置。

## 后续实现顺序

1. 测试 APK 的本地保存、导入、分享与升级恢复；补齐原生持久化。
2. 独立增加支付通知使用权入口和真实连接状态，用原生 NotificationListenerService 接收系统实际发出的支付通知；没有通知的微信付款用主动账单导入补漏。
3. 接入来源解析、重复通知幂等、双通知疑似重复、退款与待核对。普通聊天和验证码不存原文，不逐笔弹窗。
4. 真机验证后再做今日学习续接、跨设备主动交换。MCP 是后续可选查询接口。

首个测试包用于验证基础流程，不代表已实现自动监控每笔消费。
