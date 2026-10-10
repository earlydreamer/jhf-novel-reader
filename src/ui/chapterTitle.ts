/**
 * 회차 제목 앞의 화수 표시가 그 회차 번호와 같으면 뺀다(목록이 이미 'N화'를 보여 준다).
 * '제N화'·'第N話'·'N화'·'N話'(전각 숫자 포함)와 뒤의 공백·구두점을 뺀다. 빼고 남는 게 없으면 원래 제목을 쓴다.
 */
export function withoutOrdinalPrefix(title: string, ordinal: number): string {
  const digits = title.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const match = digits.match(/^\s*(?:제|第)?\s*0*(\d+)\s*(?:화|話)[\s　:：.．\-–—]*/u);
  if (!match || Number(match[1]) !== ordinal) return title;
  const rest = title.slice(match[0].length).trim();
  return rest || title;
}
