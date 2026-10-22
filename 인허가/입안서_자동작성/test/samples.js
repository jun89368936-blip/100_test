'use strict';
// 사용자 PC의 샘플 파일 경로. 용량이 커서 복사하지 않고 절대경로로 읽는다.
// 없는 PC에서는 해당 시험이 skip 된다.

const fs = require('fs');
const path = require('path');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const AI = path.join(HOME, 'Desktop', 'AI_Agent');
const INPUT = path.join(AI, '인허가');
const SAMPLE_DIR = path.join(AI, '인허가', '도시계획시설결정', '01. 도시계획시설결정(안)');
const DIDAS = path.join(
  HOME, 'Desktop', 'DIDAS DATA', '나의 프로젝트'
);

const samples = {
  // 입안서 장별 원본(완성본의 일부)
  개요: path.join(SAMPLE_DIR, '02_계획의 개요.hwp'),
  상위계획: path.join(SAMPLE_DIR, '03 상위 및 관련계획검토.hwp'),
  현황: path.join(SAMPLE_DIR, '04_지역현황 및 여건분석.hwp'),
  조성계획: path.join(SAMPLE_DIR, '05_배수지 조성계획.hwp'),
  결정안: path.join(SAMPLE_DIR, '01_도시관리계획 결정(안).hwp'),
  목차: path.join(SAMPLE_DIR, '00_목차.hwp'),
  표지: path.join(SAMPLE_DIR, '0_표지(완)-교동 삼산배수지.hwp'),
  입안신청서: path.join(INPUT, '도시계획 시설결정 입안신청서_교동삼산.pdf'),
  환경성: path.join(AI, '인허가', '도시계획시설결정', '02 환경성 검토서', '02 환경성 검토서-교동삼산배수지.hwp'),
  경관성: path.join(AI, '인허가', '도시계획시설결정', '04 경관성검토서', '04. 경관성검토서-교동삼산배수지.hwp'),
  교통성: path.join(AI, '인허가', '도시계획시설결정', '03 교통성 검토서', '교통성 검토서_교동삼산배수지(20251217).hwp'),
  // 사용자가 넣어 준 입력 자료(2026-10-21): 교동·삼산 설계보고서 1~7장, 다른 지역(여수 화정면) 현황분석 보고서 샘플
  설계1장: path.join(INPUT, '설계보고서', '제1장 총론(완).hwp'),
  설계2장: path.join(INPUT, '설계보고서', '제2장 기초자료조사(완).hwp'),
  설계3장: path.join(INPUT, '설계보고서', '제3장 관련계획조사(완).hwp'),
  설계4장: path.join(INPUT, '설계보고서', '제4장 현지조사(완).hwp'),
  설계5장: path.join(INPUT, '설계보고서', '제5장 기본계획(완).hwp'),
  설계6장: path.join(INPUT, '설계보고서', '제6장 설계기준(완).hwp'),
  설계7장: path.join(INPUT, '설계보고서', '제7장 기본설계(완).hwp'),
  // 여수 화정면(송여자도) 현황분석 샘플 — 처음 받은 자료. 2026-10-22 에 인허가 폴더의 것은 교동 보고서로 바뀌어 다운로드 사본을 쓴다
  현황분석: path.join(HOME, 'Downloads', '송여자도', 'report.hwpx'),
  필지엑셀: path.join(HOME, 'Downloads', '송여자도', '1_estate_list.xlsx'),
  // 교동배수지 현황분석 보고서(2026-10-22 사용자 제공)
  교동현황: path.join(INPUT, '현황분석 보고서', 'report.hwpx'),
  교동필지: path.join(INPUT, '현황분석 보고서', '1_estate_list.xlsx'),
  // 예전에 쓰던 수정중 본(설계보고서 1장)
  설계총론: path.join(
    DIDAS,
    '교동·삼산배수지 건설공사 기본 및 실시설계용역_02-2024-081',
    '실시설계', '성과품 취합', '보고서',
    '1. 교동·배수지 건설공사 기본 및 실시설계 보고서 및 부록',
    '제1장 총론(수정중).hwp'
  ),
  // 일반화 시험용 다른 프로젝트
  군남총론: path.join(
    DIDAS,
    '군남면 계획배수지신설공사 기본 및 실시설계용역_02-2011-027',
    '성과품', '준공 성과품', '09.성과품 CD', '1.0 보고서',
    '연천실시-1장 총론(비상연결 포함).hwp'
  ),
  hwpx: path.join(
    DIDAS,
    '매봉재배수지 신설사업 기본 및 실시설계 용역_02-2026-068',
    '보고자료', '공정보고', '2026년 8월',
    '[첨부4] 인허가 flow chart.hwpx'
  ),
};

function has(...keys) {
  return keys.every((k) => fs.existsSync(samples[k]));
}

/** node:test 용 skip 옵션: { skip: skipUnless('설계총론') } */
function skipUnless(...keys) {
  const missing = keys.filter((k) => !fs.existsSync(samples[k]));
  return missing.length ? `샘플 파일 없음: ${missing.join(', ')}` : false;
}

module.exports = { samples, has, skipUnless };
