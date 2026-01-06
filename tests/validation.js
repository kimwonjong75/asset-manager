function percentChange(current, yesterday) {
  if (yesterday <= 0) return 0;
  return ((current - yesterday) / yesterday) * 100;
}

function run() {
  const samsYesterday = 128500;
  const samsToday = 134400;
  const samsPct = percentChange(samsToday, samsYesterday);
  console.log('삼성전자 어제대비(기대값):', samsPct.toFixed(2) + '%'); 

  const wrongYesterday = 138100;
  const wrongPct = percentChange(samsToday, wrongYesterday);
  console.log('삼성전자 어제대비(잘못된 기준일자):', wrongPct.toFixed(2) + '%');

  // 서버 제공 change_rate 검증 예시
  const serverPrev = 9500;
  const serverPrice = 10000;
  const serverChangeRate = 0.052; // 5.2%
  const computedRate = percentChange(serverPrice, serverPrev) / 100; // 소수
  console.log('서버 change_rate:', (serverChangeRate * 100).toFixed(2) + '%', '계산값:', (computedRate * 100).toFixed(2) + '%');

  // 신호 라벨 예시 출력 (간단 확인)
  const signals = ['STRONG_BUY','BUY','SELL','STRONG_SELL','NEUTRAL'];
  signals.forEach(s => console.log('Signal:', s));
}

run();
