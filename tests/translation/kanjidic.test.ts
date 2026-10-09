import { describe, expect, it } from 'vitest';
import { loadKanjidic, sinoKoreanReadings } from '../../src/translation/kanjidic';

describe('KANJIDIC2 조회', () => {
  it('王의 한국어 한자음과 영어 뜻을 준다', async () => {
    const dic = await loadKanjidic();
    expect(dic.lookup('王')?.ko).toContain('왕');
    expect(dic.lookup('王')?.en).toContain('king');
  });

  it('蝮의 영어 뜻에 viper가 있다', async () => {
    const dic = await loadKanjidic();
    expect(dic.lookup('蝮')?.en).toContain('viper');
  });

  it('사전에 없는 글자는 null이다', async () => {
    const dic = await loadKanjidic();
    expect(dic.lookup('の')).toBeNull();
  });

  it('한자어의 글자별 한국어 한자음을 낸다', async () => {
    const dic = await loadKanjidic();
    const readings = sinoKoreanReadings(dic, '魔石');
    expect(readings[0]).toContain('마');
    expect(readings[1]).toContain('석');
  });

  it('비한자 글자는 그 글자 하나를 후보로 준다', async () => {
    const dic = await loadKanjidic();
    expect(sinoKoreanReadings(dic, '王都の')[2]).toEqual(['の']);
  });
});
