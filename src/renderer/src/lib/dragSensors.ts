import { PointerSensor, PointerActivationConstraints, KeyboardSensor } from '@dnd-kit/dom'

export const dragSensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })]
  }),
  KeyboardSensor
]
