/**
 * E4B 일본어 소설 실측은 약 4.52 UTF-8 B/토큰이지만 그 평균을 모든 문자열에 적용하면 숫자,
 * ID, 희귀 문자에서 과소 추정한다. 검증한 E4B만 문자별 여유를 둔 추정기를 사용하고,
 * 다른 모델과 이전 호출자는 1 B/토큰 추정으로 남긴다. 정확한 서버 토크나이저는 아니다.
 */
export function hasCalibratedEstimator(modelId: string): boolean {
  return /(?:^|[/\\])(?:google\/)?gemma[-_. ]?4[-_. ]?e4b(?:[-_. /]|$)/i.test(modelId);
}

export function estimatePromptTokens(text: string, modelId = ''): number {
  const encoder = new TextEncoder();
  if (!hasCalibratedEstimator(modelId)) return encoder.encode(text).length + 128;
  let tokens = 128;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7a3)) tokens += 1;
    else if (code >= 0x4e00 && code <= 0x9fff) tokens += 2;
    else tokens += encoder.encode(character).length;
  }
  return tokens;
}
