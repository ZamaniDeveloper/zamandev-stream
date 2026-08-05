# ZamanDev Stream

[فارسی](#فارسی) | [English](#english)

## فارسی

یک پلتفرم فارسی و راست‌به‌چپ برای تماس تصویری، کنفرانس گروهی و پخش زنده مبتنی بر WebRTC که برای اتصال‌های کم‌سرعت نیز پروفایل‌های اختصاصی دارد.

## امکانات

- سه حالت جلسه: پخش زنده یک‌به‌چند، کنفرانس گروهی و تماس خصوصی دونفره
- نقش‌های جداگانه استریمر و تماشاگر در حالت پخش زنده
- تماس صوتی و تصویری همتابه‌همتا با WebRTC و سیگنالینگ Socket.IO
- چهار پروفایل کیفیت: 720p، 480p، 240p و فقط صدا
- کاهش خودکار کیفیت هنگام افزایش packet loss
- پایش زنده RTT، اتلاف بسته، سرعت دریافت/ارسال و رزولوشن
- محدودسازی bitrate و فعال‌سازی FEC برای صدای Opus در شبکه‌های ضعیف
- قطع و وصل میکروفون و دوربین و نمایش وضعیت رسانه شرکت‌کنندگان
- تعویض دوربین جلو و عقب در موبایل
- اشتراک‌گذاری صفحه‌نمایش
- تخته سفید همگام با قلم، پاک‌کن، رنگ و اندازه‌های مختلف
- گفت‌وگوی متنی زنده، فهرست شرکت‌کنندگان و شمارنده تماشاگران
- رابط فارسی RTL، واکنش‌گرا و مناسب موبایل
- قابلیت نصب به‌صورت PWA و cache دارایی‌های رابط کاربری
- آدرس‌های تمیز `/` و `/room`

## فناوری‌ها

- Node.js و Express
- Socket.IO
- WebRTC
- HTML، CSS و JavaScript بدون فریم‌ورک
- Service Worker و Web App Manifest

## اجرای محلی

پیش‌نیاز: Node.js 18 یا جدیدتر.

```bash
npm install
npm start
```

سپس `http://localhost:3000` را باز کنید. برای آزمایش تماس، برنامه را در دو مرورگر یا دستگاه باز کرده و با Room ID یکسان وارد شوید.

برای توسعه با راه‌اندازی مجدد خودکار:

```bash
npm run dev
```

## استقرار

سرویس باید روی HTTPS اجرا شود؛ دسترسی مرورگر به دوربین، میکروفون، Service Worker و اشتراک صفحه خارج از localhost معمولاً به secure context نیاز دارد. متغیر محیطی `PORT` برای تعیین پورت سرور پشتیبانی می‌شود.

تنظیمات پیش‌فرض فقط از STUN عمومی استفاده می‌کند. برای عبور قابل‌اعتماد از NAT/CGNAT در محیط واقعی، یک TURN server متعلق به خودتان راه‌اندازی و تنظیمات آن را در `public/js/webrtc-helper.js` وارد کنید. اطلاعات TURN که در کد سمت مرورگر قرار می‌گیرد برای کاربران قابل مشاهده است؛ از credential کوتاه‌عمر یا محدودشده استفاده کنید.

## محدودیت‌های فعلی

- معماری کنفرانس mesh است و برای اتاق‌های بزرگ به SFU نیاز دارد.
- احراز هویت، رمز ورود اتاق، ذخیره پیام‌ها و ضبط جلسه پیاده‌سازی نشده است.
- وضعیت اتاق‌ها در حافظه سرور نگهداری می‌شود و با restart پاک می‌شود.
- برای اتصال پایدار در شبکه‌های محدودشده باید TURN اختصاصی تنظیم شود.

## مجوز

[MIT](LICENSE) © 2026 Mohsen Zamani

---

## English

A Persian, right-to-left WebRTC platform for video calls, group conferencing, and live streaming, featuring dedicated quality profiles for low-bandwidth connections.

## Features

- Three room modes: one-to-many live streaming, group conferencing, and private one-to-one calls
- Separate broadcaster and viewer roles in live-stream mode
- Peer-to-peer audio and video using WebRTC with Socket.IO signaling
- Four quality profiles: 720p, 480p, 240p, and audio-only
- Automatic quality reduction when packet loss increases
- Live monitoring of RTT, packet loss, upload/download speed, and resolution
- Bitrate limiting and Opus FEC for more resilient audio on weak networks
- Microphone and camera controls with participant media-state indicators
- Front and rear camera switching on mobile devices
- Screen sharing
- Synchronized whiteboard with pen, eraser, colors, and multiple stroke sizes
- Live text chat, participant list, and viewer counter
- Responsive, mobile-friendly Persian RTL interface
- Installable PWA with interface asset caching
- Clean `/` and `/room` URLs

## Technology

- Node.js and Express
- Socket.IO
- WebRTC
- Framework-free HTML, CSS, and JavaScript
- Service Worker and Web App Manifest

## Local setup

Requirement: Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`. To test a call, open the application in two browsers or devices and join with the same Room ID.

For development with automatic restarts:

```bash
npm run dev
```

## Deployment

Deploy the service over HTTPS. Outside localhost, browser access to the camera, microphone, Service Worker, and screen sharing generally requires a secure context. The server supports the `PORT` environment variable.

The default configuration uses public STUN servers only. For reliable NAT/CGNAT traversal in production, operate your own TURN service and configure it in `public/js/webrtc-helper.js`. TURN credentials embedded in browser code are visible to users, so use short-lived or appropriately restricted credentials.

## Current limitations

- Conference rooms use a mesh architecture; large rooms require an SFU.
- Authentication, room passwords, message persistence, and session recording are not implemented.
- Room state is stored in server memory and is cleared when the server restarts.
- Restricted networks require a dedicated TURN service for reliable connectivity.

## License

[MIT](LICENSE) © 2026 Mohsen Zamani
