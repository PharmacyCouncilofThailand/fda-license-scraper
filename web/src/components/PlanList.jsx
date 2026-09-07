/** Plans by date, with how far each one has got. */
export default function PlanList({ plans, currentId, onPick, onCreate, onDelete }) {
  return (
    <div className="plan-list">
      <div className="head">
        <b>แผนการตรวจ</b>
        <button type="button" className="link" onClick={onCreate}>
          + แผนใหม่
        </button>
      </div>
      {plans.length === 0 && <div className="empty">ยังไม่มีแผนการตรวจ</div>}
      <ul>
        {plans.map((plan) => (
          <li key={plan.id} className={plan.id === currentId ? 'current' : undefined}>
            <button type="button" onClick={() => onPick(plan.id)}>
              <b>{plan.date}</b>
              <small>
                {plan.total} ร้าน · ตรวจแล้ว {plan.done}
              </small>
            </button>
            <button
              type="button"
              className="remove"
              title="ลบแผนนี้"
              onClick={() => onDelete(plan.id)}
            >
              <span className="material-symbols-outlined sm">delete</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
