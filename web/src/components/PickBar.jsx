import { Button } from '@/components/ui/button';

/**
 * The working plan, kept in view while the officer scrolls the results —
 * each card's "+ ใส่แผน" files a shop into this plan directly, so this bar
 * only needs to say which plan that is and offer a way to switch it.
 */
export default function PickBar({ activePlan, onSwitchPlan }) {
  if (!activePlan) return null;

  return (
    <div className="pickbar glass-panel">
      <div className="who">
        <b>แผนที่กำลังใส่: {activePlan.date}</b>
        <small>{activePlan.id}</small>
      </div>
      <Button variant="outline" className="ml-auto" onClick={onSwitchPlan}>
        สลับแผน
      </Button>
      <Button size="lg" onClick={() => (window.location.hash = `#/plans`)}>
        ดูแผน
      </Button>
    </div>
  );
}
