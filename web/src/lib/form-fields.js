/*
 * Every blank and every checkbox on the record, grouped into the six steps
 * the touch wizard walks through.
 *
 * The names here are the record's own — `name=` on an input, `data-name=` on
 * a check button in web/public/form.html — because they travel to the PDF
 * unchanged through `applyData()`. `test-form-fields.js` compares this file
 * against that page in both directions on every run, which is what makes it
 * safe for the paper and the wizard to be two files.
 *
 * Labels are shortened from the record's own wording: the paper reads as one
 * long sentence with blanks in it, which a phone cannot show, so each blank
 * gets the words immediately around it.
 */

export const STEPS = [
  { n: 1, title: 'สถานที่และเวลา' },
  { n: 2, title: 'ผู้รับอนุญาต และผู้มีหน้าที่ปฏิบัติการ' },
  { n: 3, title: 'ผลการตรวจ (1)–(4)' },
  { n: 4, title: 'ผลการตรวจ (5)–(12)' },
  { n: 5, title: 'ภาพถ่าย และเอกสารที่สแกน' },
  { n: 6, title: 'ลงชื่อ และออกเอกสาร' },
];

export const FIELDS = [
  // --- step 1: heading and place ------------------------------------------
  { name: 'officers1', step: 1, label: 'พนักงานเจ้าหน้าที่ผู้ตรวจ', type: 'officers' },
  { name: 'officers2', step: 1, label: 'พนักงานเจ้าหน้าที่ผู้ตรวจ (บรรทัดที่ 2)', type: 'officers' },
  { name: 'pharmacistName', step: 1, label: 'ตรวจสถานที่ทำการของผู้ประกอบวิชาชีพเภสัชกรรมชื่อ', type: 'text' },
  { name: 'pharmacistLicenseNo', step: 1, label: 'ใบอนุญาตผู้ประกอบวิชาชีพเภสัชกรรม เลขที่ ภ.', type: 'text' },
  { name: 'pharmacistLicenseExpiry', step: 1, label: 'หมดอายุวันที่', type: 'text' },
  { name: 'placeName', step: 1, label: 'ชื่อสถานที่ทำการ', type: 'text' },
  { name: 'houseNo', step: 1, label: 'ตั้งอยู่เลขที่', type: 'text' },
  { name: 'village', step: 1, label: 'หมู่บ้าน / อาคาร', type: 'text' },
  { name: 'moo', step: 1, label: 'หมู่ที่', type: 'text' },
  { name: 'soi', step: 1, label: 'ตรอก / ซอย', type: 'text' },
  { name: 'road', step: 1, label: 'ถนน', type: 'text' },
  { name: 'subdistrict', step: 1, label: 'แขวง / ตำบล', type: 'text' },
  { name: 'district', step: 1, label: 'เขต / อำเภอ', type: 'text' },
  { name: 'province', step: 1, label: 'จังหวัด', type: 'text' },
  { name: 'phone', step: 1, label: 'เบอร์โทรศัพท์ติดต่อ', type: 'text' },
  { name: 'policeStation', step: 1, label: 'เขตสถานีตำรวจ', type: 'text' },
  { name: 'inspectDate', step: 1, label: 'เข้าตรวจเมื่อวันที่', type: 'text' },
  { name: 'inspectTime', step: 1, label: 'เวลา (น.)', type: 'time' },

  // --- step 2: items 1 and 2 ----------------------------------------------
  { name: 'licenseeName', step: 2, label: '1. ชื่อผู้รับอนุญาตของสถานที่ทำการ', type: 'text' },
  { name: 'operatorName', step: 2, label: 'ชื่อผู้ดำเนินการกิจการ', type: 'text' },
  { name: 'licenseNo', step: 2, label: 'ใบอนุญาตขายยาแผนปัจจุบันเลขที่', type: 'text' },
  { name: 'dutyPharmacist', step: 2, label: '2. ชื่อผู้มีหน้าที่ปฏิบัติการ', type: 'text' },
  { name: 'dutyLicenseNo', step: 2, label: 'ใบอนุญาตผู้ประกอบวิชาชีพเภสัชกรรม เลขที่ ภ.', type: 'text' },
  { name: 'dutyLicenseExpiry', step: 2, label: 'หมดอายุวันที่', type: 'text' },
  { name: 'openHours', step: 2, label: 'เวลาทำการของผู้มีหน้าที่ปฏิบัติการ (น.)', type: 'textarea' },

  // --- step 3: items (1)–(4) ----------------------------------------------
  { name: 'checkTime', step: 3, label: '(1) ขณะตรวจสอบเวลา (น.)', type: 'time' },
  { name: 'shopNameAtCheck', step: 3, label: 'ร้าน', type: 'text' },
  { name: 'personFound', step: 3, label: 'พบ (ชื่อผู้ที่พบขณะตรวจ)', type: 'text' },
  { name: 'personIdCard', step: 3, label: 'บัตรประจำตัวประชาชนเลขที่', type: 'text' },
  { name: 'ruled1', step: 3, label: 'รายละเอียดที่ให้ไว้ (บรรทัดที่ 1)', type: 'text' },
  { name: 'ruled2', step: 3, label: 'รายละเอียดที่ให้ไว้ (บรรทัดที่ 2)', type: 'text' },
  { name: 'ruled3', step: 3, label: 'รายละเอียดที่ให้ไว้ (บรรทัดที่ 3)', type: 'text' },
  { name: 'buyRequest', step: 3, label: '(2) ขอซื้อยาซึ่ง', type: 'text' },
  { name: 'drugDispensed', step: 3, label: 'ได้จ่ายยา', type: 'text' },
  { name: 'drugQuantity', step: 3, label: 'จำนวน', type: 'text' },
  { name: 'drugPrice', step: 3, label: 'ราคา (บาท)', type: 'text' },
  { name: 'regNo', step: 3, label: 'Reg No.', type: 'text' },
  { name: 'lot', step: 3, label: 'Lot', type: 'text' },
  { name: 'mfgDate', step: 3, label: 'วันผลิต', type: 'text' },
  { name: 'expDate', step: 3, label: 'ยาสิ้นอายุ', type: 'text' },
  { name: 'ruled4', step: 3, label: 'รายละเอียดยาเพิ่มเติม', type: 'text' },
  { name: 'notDispensedReason', step: 3, label: 'ไม่ได้จ่ายยา เนื่องจาก', type: 'textarea' },
  { name: 'admitPerson', step: 3, label: '(3) ผู้ที่ยอมรับ (ชื่อ)', type: 'text' },
  { name: 'complaintDetail', step: 3, label: '(4) แจ้งว่า (รายละเอียดเบาะแส / ข้อร้องเรียน)', type: 'textarea' },
  { name: 'acknowledgedBy', step: 3, label: 'ผู้รับทราบวัตถุประสงค์การตรวจ', type: 'text' },

  // --- step 4: items (5)–(12) ---------------------------------------------
  { name: 'dutyNote', step: 4, label: '(6) หมายเหตุการอยู่ปฏิบัติหน้าที่', type: 'textarea' },
  { name: 'leaveProofNote', step: 4, label: '(7) หลักฐานการลางาน', type: 'text' },
  { name: 'leaveProofNote2', step: 4, label: '(7) หลักฐานการลางาน (บรรทัดที่ 2)', type: 'text' },
  { name: 'curtainNote', step: 4, label: '(8) หมายเหตุการปิดม่านบังยาอันตราย', type: 'textarea' },
  { name: 'signPage1Name', step: 4, label: 'ชื่อผู้ลงชื่อท้ายหน้า 1 (ในวงเล็บ)', type: 'text' },
  { name: 'behaviour1', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม', type: 'text' },
  { name: 'behaviour2', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม (บรรทัดที่ 2)', type: 'text' },
  { name: 'behaviour3', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม (บรรทัดที่ 3)', type: 'text' },
  { name: 'behaviour4', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม (บรรทัดที่ 4)', type: 'text' },
  { name: 'behaviour5', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม (บรรทัดที่ 5)', type: 'text' },
  { name: 'seizedItems', step: 4, label: '(10) ยึด', type: 'text' },
  { name: 'seizedCount', step: 4, label: 'จำนวน (รายการ)', type: 'text' },
  { name: 'heldItems', step: 4, label: '(10) อายัด', type: 'text' },
  { name: 'heldCount', step: 4, label: 'จำนวน (รายการ)', type: 'text' },
  { name: 'endTime', step: 4, label: '(12) สิ้นสุดการตรวจเวลา (น.)', type: 'time' },

  // --- step 6: the signature block's name blanks ---------------------------
  { name: 'signDutyName', step: 6, label: 'ชื่อผู้มีหน้าที่ปฏิบัติการ / เภสัชกร (ในวงเล็บ)', type: 'text' },
  { name: 'signLicenseeName', step: 6, label: 'ชื่อผู้รับอนุญาต / ผู้แทน (ในวงเล็บ)', type: 'text' },
  { name: 'signOfficer1', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 1', type: 'officers' },
  { name: 'signOfficer2', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 2', type: 'officers' },
  { name: 'signOfficer3', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 3', type: 'officers' },
  { name: 'signOfficer4', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 4', type: 'officers' },
  { name: 'signOfficer5', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 5', type: 'officers' },
];

export const CHECK_GROUPS = [
  {
    group: 'shopState',
    step: 3,
    label: '(1) สภาพร้านขณะตรวจ',
    mode: 'one',
    options: [
      { name: 'shopOpen', label: 'เปิดทำการตามปกติ' },
      { name: 'shopClosed', label: 'ปิดทำการ' },
    ],
  },
  {
    group: 'role',
    step: 3,
    label: '(1) ผู้ที่พบทำหน้าที่',
    mode: 'one',
    options: [
      { name: 'rolePharmacist', label: 'เภสัชกรผู้มีหน้าที่ปฏิบัติการ' },
      { name: 'roleLicensee', label: 'ผู้รับอนุญาต' },
      { name: 'roleAgent', label: 'ผู้แทนผู้รับอนุญาต' },
    ],
  },
  {
    group: 'buy',
    step: 3,
    label: '(2) การขอซื้อยาก่อนเข้าตรวจ',
    mode: 'one',
    options: [
      { name: 'noBuy', label: 'ไม่ได้ขอซื้อยา' },
      { name: 'didBuy', label: 'ขอซื้อยา' },
    ],
  },
  {
    group: 'dispensed',
    step: 3,
    label: '(2) ผลการขอซื้อ',
    mode: 'one',
    options: [{ name: 'notDispensed', label: 'ไม่ได้จ่ายยา' }],
  },
  {
    group: 'admit',
    step: 3,
    label: '(3) การยอมรับ',
    mode: 'one',
    options: [{ name: 'admitSold', label: 'ได้ขายยาตาม (2) ให้กับพนักงานเจ้าหน้าที่' }],
  },
  {
    group: 'source',
    step: 3,
    label: '(4) ที่มาของการตรวจ',
    mode: 'many',
    options: [
      { name: 'sourceTip', label: 'มีการแจ้งเบาะแสมายังสภาเภสัชกรรม' },
      { name: 'sourcePlan', label: 'แผนการเฝ้าระวังตามมติที่ประชุมคณะกรรมการสภาเภสัชกรรม' },
      { name: 'sourceComplaint', label: 'มีผู้ร้องเรียน' },
    ],
  },
  {
    group: 'licencePresence',
    step: 4,
    label: '(5) การแสดงใบอนุญาตของผู้มีหน้าที่ปฏิบัติการ',
    mode: 'one',
    options: [
      { name: 'licenceShown', label: 'พบ' },
      { name: 'licenceNotShown', label: 'ไม่พบ' },
    ],
  },
  {
    group: 'licenceKind',
    step: 4,
    label: '(5) ใบอนุญาตที่แสดง',
    mode: 'one',
    options: [
      { name: 'licenceOriginal', label: 'ฉบับจริง' },
      { name: 'licenceCopy', label: 'ฉบับสำเนา' },
    ],
  },
  {
    group: 'dutyPresence',
    step: 4,
    label: '(6) ผู้มีหน้าที่ปฏิบัติการอยู่ปฏิบัติหน้าที่',
    mode: 'one',
    options: [
      { name: 'dutyPresent', label: 'พบ' },
      { name: 'dutyAbsent', label: 'ไม่พบ' },
    ],
  },
  {
    group: 'leaveProof',
    step: 4,
    label: '(7) หลักฐานการลางานของเภสัชกร',
    mode: 'one',
    options: [
      { name: 'leaveProofYes', label: 'มี' },
      { name: 'leaveProofNo', label: 'ไม่มี' },
    ],
  },
  {
    group: 'curtain',
    step: 4,
    label: '(8) การปิดม่านบังยาอันตราย',
    mode: 'one',
    options: [
      { name: 'curtainFound', label: 'พบ การปิดม่านบังยาอันตราย' },
      { name: 'curtainNotFound', label: 'ไม่พบ การปิดม่านบังยาอันตราย' },
    ],
  },
  {
    group: 'inform',
    step: 4,
    label: '(11) ผู้รับทราบข้อมูลที่แจ้ง',
    mode: 'many',
    options: [
      { name: 'informPharmacist', label: 'เภสัชกรผู้มีหน้าที่ปฏิบัติการ' },
      { name: 'informLicensee', label: 'ผู้รับอนุญาต' },
      { name: 'informAgent', label: 'ผู้แทนผู้รับอนุญาต' },
    ],
  },
];
