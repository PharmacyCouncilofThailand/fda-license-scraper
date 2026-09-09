export default function RecordForm({ planId, newCode }) {
  return (
    <div className="record-form">
      บันทึกการตรวจของร้าน {newCode} ในแผน {planId}
    </div>
  );
}
