/** 모델 ID(llama.cpp는 서버 파일 경로)에서 사람이 읽을 이름을 만든다. 요청·저장에는 원래 ID를 쓴다(#176, #180). */
export function readableModelName(id: string): string {
  const last = id.split(/[/\\]/).filter(Boolean).at(-1) ?? id;
  return last.replace(/\.(gguf|bin|safetensors)$/i, '');
}
