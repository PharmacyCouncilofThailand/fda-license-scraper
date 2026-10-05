# ติดตั้งระบบตรวจร้านยาบนเครื่องของสภาเภสัชกรรม

เว็บนี้ใช้เตรียมงานในสำนักงานเท่านั้น ได้แก่ ค้นร้าน วางแผน กรอกฟอร์ม
ข้อมูลเภสัชกร และเก็บไฟล์ใน "ไดรฟ์" จึงรันบนเครื่องในแลนของสภาได้ และไม่ต้อง
เปิดอะไรออกนอกสภา ข้อมูลทั้งหมดเก็บบน NAS ของสภา

```
เครื่องพนักงาน ──http──▶ เครื่องที่รันเว็บ (Docker) ──SMB──▶ NAS ของสภา
                              │
                              └──https ขาออก──▶ เว็บ อย. / สภาเภสัชกรรม
```

## สิ่งที่ต้องเตรียม

1. **เครื่องที่รันเว็บ** 1 เครื่อง (Linux แนะนำ หรือ Windows ที่มี Docker Desktop)
   - Docker และ Docker Compose
   - RAM 2 GB ขึ้นไป เพราะการสร้าง PDF ต้องรัน Chromium
   - ออกอินเทอร์เน็ตขาออกทาง HTTPS ได้ เพราะเว็บต้องดึงข้อมูลจาก
     `porta.fda.moph.go.th`, `pertento.fda.moph.go.th` และ `www.pharmacycouncil.org`
   - **ไม่ต้อง**เปิด port ขาเข้าจากอินเทอร์เน็ต
2. **NAS: สร้าง shared folder 2 อัน**
   - `fda-drive` สำหรับหน้า "ไดรฟ์" พนักงานเปิดโฟลเดอร์นี้จาก Windows
     ได้ด้วย แต่ไม่ควรตั้งชื่อไฟล์ด้วยอักขระ `< > : " | ? *`
   - `fda-app-data` สำหรับแผน บันทึกการตรวจ และรูปถ่ายของระบบ ให้ระบบเข้าได้คนเดียว
   - สร้างบัญชีบน NAS ที่อ่านและเขียนได้**เฉพาะ**สองโฟลเดอร์นี้ และเปิด SMB 3
3. **ไฟล์แม่แบบ Word** ชื่อ `inspection-form.docx` วางไว้ที่ `templates/` ในโฟลเดอร์โปรเจกต์
   ไฟล์นี้ไม่อยู่ใน git เพราะมีชื่อเจ้าหน้าที่ ถ้าไม่มี ปุ่มดาวน์โหลด Word จะใช้ไม่ได้
   แต่ PDF ยังใช้ได้

## ติดตั้ง

```bash
git clone https://github.com/Setto-TSET/fda-license-scraper.git
cd fda-license-scraper/deploy/council
cp .env.example .env
nano .env                       # ใส่ PLANS_PASSCODE, NAS_HOST, ชื่อ share, บัญชี NAS
docker compose up -d --build
```

ตรวจว่าใช้ได้:

```bash
curl http://localhost/health
# {"ok":true,"plansStore":"file","photoStore":"file","driveStore":"file"}
```

จากนั้นเปิด `http://<IP หรือชื่อเครื่อง>/` จากเครื่องพนักงาน แล้วลองอัปโหลดไฟล์ในหน้า
"ไดรฟ์" ไฟล์ที่อัปโหลดต้องไปโผล่ใน `\\<NAS>\fda-drive`

ถ้าต้องการให้เข้าด้วยชื่อ เช่น `http://inspect.<โดเมนสภา>` ให้เพิ่ม DNS record ภายใน
(internal DNS) ชี้มาที่เครื่องนี้

## อัปเดตเวอร์ชัน

```bash
cd fda-license-scraper && git pull
cd deploy/council && docker compose up -d --build
```

ข้อมูลไม่หาย เพราะอยู่บน NAS ไม่ได้อยู่ใน container

## สำรองข้อมูล

ข้อมูลทั้งหมดอยู่ในสองโฟลเดอร์บน NAS ใช้ snapshot หรือ backup ของ NAS ตามปกติได้เลย

## แก้ปัญหา

| อาการ | สาเหตุที่พบบ่อย |
| --- | --- |
| `docker compose up` ขึ้น `mount error(13): Permission denied` | ชื่อผู้ใช้หรือรหัสผ่าน NAS ผิด หรือบัญชีไม่มีสิทธิ์เข้า share |
| `mount error(95)` หรือ `Operation not supported` | NAS ไม่รองรับ SMB 3 ให้ลอง `NAS_SMB_VERSION=2.1` |
| เว็บขึ้น แต่บันทึกแผนหรืออัปโหลดแล้ว error | บัญชี NAS อ่านได้แต่เขียนไม่ได้ |
| ค้นร้านไม่ได้ | เครื่องออกอินเทอร์เน็ตไปเว็บ อย. ไม่ได้ ให้ตรวจ firewall หรือ proxy ขาออก |
| PDF ภาษาไทยเป็นกล่อง ๆ | image ไม่ได้ build จาก Dockerfile ของโปรเจกต์ ซึ่งมีฟอนต์ไทยมาให้ |
