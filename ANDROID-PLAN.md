# 学迹 Android 方案

本次确定范围：Android 不做桌宠或悬浮宠物。现有 Windows 桌宠保持原样。尚未生成或验证 APK。

## 打包方式

使用 Capacitor 将现有 HTML / CSS / JavaScript 放进 Android WebView；Electron 主进程不能直接装入 APK。先把网页资源整理到独立 webDir，将 `window.landing` 的桌面 IPC 与移动能力分开，再添加 Android 工程。

建议迁移顺序：

1. 本地计划、学习断点文字、可调整专注计时、每日复盘、人民币记账、中日英界面。先保持本地使用，不做默认云同步。
2. 数据备份改为 Android 文件分享 / 选择文件；计时用绝对结束时间恢复，通知使用原生能力，不能依赖 WebView 后台 JS 定时器一直运行。
3. 应用使用时间通过原生 Android `UsageStatsManager` 接入，需要用户在系统设置明确授予「使用情况访问权限」。没有授权时显示说明，不显示虚构时长。按事件区间统计和处理跨日，避免把使用跨度误作连续前台时间。
4. 若之后需要「截屏识别视频断点」，另接 MediaProjection 原生流程并遵守系统截屏授权；首版可以先选图 / 手动录入，不将 Windows desktopCapturer 搬进 Android。

## 产物

- 自己安装 / GitHub 下载：签名 APK。
- 如果上架 Google Play：签名 Android App Bundle（AAB）。
- 正式签名密钥由应用所有者保管，不提交 Git。之后更新包使用相同包名、签名和递增版本代码。
- 先做独立 Android 构建验证；不会把尚未通过真机测试的包称为已发布。

## 官方参考

- https://capacitorjs.com/docs/getting-started
- https://capacitorjs.com/docs/android
- https://developer.android.com/reference/android/app/usage/UsageStatsManager
- https://developer.android.com/media/grow/media-projection
- https://developer.android.com/studio/publish/app-signing
