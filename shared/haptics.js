import { Vibrator } from "@zos/sensor";

// One short "key click" pulse confirming an action that has no other feedback.
// Chosen on the watch with a probe: the VIBRATOR_SCENE_* modes buzz twice and
// too hard on the Active 3 Premium motor.
let vibrator = null;
let clickType = null;

function click() {
  try {
    if (!vibrator) {
      vibrator = new Vibrator();
      clickType = vibrator.getType().KEYCODE_CLICK;
    }
    // start([...]) takes getType() values, not VIBRATOR_SCENE_* constants
    vibrator.start([{ type: clickType }]);
  } catch (e) {
    console.log("vibrate failed", e);
  }
}

// A tap did something
export function tick() {
  click();
}

// A hold went through, the finger can be lifted
export function bump() {
  click();
}
