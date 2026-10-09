// 화면 대기(findBy*, waitFor)는 대부분 백그라운드 컨트롤러 작업의 결과를 기다린다. 기본 1초는 다른 vitest와
// 동시에 돌 때 모자라 간헐 실패를 낸다(#186 측정). 대기 한도는 판정 기준이 아니라 멈춤을 끊는 안전장치다.
// node 환경 테스트에는 DOM 테스트 도구를 불러오지 않는다.
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 10_000 });
}
export {};
