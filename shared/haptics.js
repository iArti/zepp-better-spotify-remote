import { Vibrator, VIBRATOR_SCENE_SHORT_LIGHT, VIBRATOR_SCENE_SHORT_MIDDLE } from "@zos/sensor";

// Short buzzes confirming an action that has no other feedback
let vibrator = null;

function buzz(type) {
  try {
    if (!vibrator) vibrator = new Vibrator();
    // Scene constants go to setMode; start([...]) wants getType() values instead
    vibrator.stop();
    vibrator.setMode(type);
    vibrator.start();
  } catch (e) {
    console.log("vibrate failed", e);
  }
}

// Lightest pulse (20 ms): a tap did something
export function tick() {
  buzz(VIBRATOR_SCENE_SHORT_LIGHT);
}

// Medium pulse (20 ms): a hold went through, the finger can be lifted
export function bump() {
  buzz(VIBRATOR_SCENE_SHORT_MIDDLE);
}
