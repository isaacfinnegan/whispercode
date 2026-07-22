export type PromptInputV2SwipePoint = { x: number; y: number; time: number }

export function isPromptInputV2VoiceSwipe(start: PromptInputV2SwipePoint, end: PromptInputV2SwipePoint) {
  return end.x - start.x < -50 && Math.abs(end.y - start.y) < 25 && end.time - start.time < 300
}
