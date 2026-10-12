"use client";
// 주요 수치를 0에서 목표값까지 0.6초 동안 올리는 숫자. 처음 화면에 그려질 때 한 번만 움직인다.
// '애니메이션 줄이기' 설정을 켠 사용자에게는 바로 최종값을 보여준다.
import { useEffect, useState } from "react";

const DURATION_MS = 600;

export default function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - (1 - progress) ** 3; // 끝으로 갈수록 천천히
      setShown(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  // 화면 읽기 프로그램에는 움직이는 숫자 대신 최종값을 알려준다.
  return (
    <span aria-label={String(value)}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
