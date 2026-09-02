#!/usr/bin/env python3
"""
긴 작업(100GB 스캔, TransNetV2 추론) 도중 맥이 잠들지 않게 막는다.

macOS 내장 `caffeinate`를 자식 프로세스로 띄우고 `-w <우리 PID>`로 묶어둔다.
이렇게 하면 스크립트가 어떻게 끝나든(정상 종료·에러·Ctrl+C·강제 종료)
caffeinate가 따라서 죽으므로 절전 억제가 영구히 남는 사고가 없다.

한계: **노트북 뚜껑을 닫으면 caffeinate와 무관하게 잠든다.**
외장에서 100GB를 읽는 동안엔 뚜껑을 열어둬야 한다.
"""
import atexit
import os
import shutil
import subprocess
import sys


class KeepAwake:
    """with 블록 동안 절전과 화면 잠금을 막는다.

    -d  화면 절전 방지 ← 이게 잠금화면(암호 재입력)을 막는 핵심
    -i  유휴 시스템 절전 방지
    -m  디스크 유휴 절전 방지 (외장에서 계속 읽으므로 필수)
    -s  시스템 절전 방지 (전원 연결 시)
    -w  이 PID가 살아있는 동안만

    이 맥의 실제 설정은 AC 전원에서 `sleep 0`(시스템 절전 없음) + `displaysleep 10`이었다.
    즉 잠기는 원인은 시스템 절전이 아니라 **10분 뒤 화면 꺼짐 → 잠금화면**이므로
    -d 없이는 아무리 -i -s를 걸어도 암호를 다시 쳐야 한다.

    display=False로 주면 화면은 꺼지게 두고 작업만 유지한다(전력 절약).
    """

    def __init__(self, enabled=True, verbose=True, display=True):
        self.enabled = enabled
        self.verbose = verbose
        self.display = display
        self.proc = None

    def __enter__(self):
        if not self.enabled:
            return self
        if sys.platform != "darwin" or not shutil.which("caffeinate"):
            if self.verbose:
                print("절전 방지: 미지원 환경 — 건너뜀")
            return self
        flags = "-dims" if self.display else "-ims"
        try:
            self.proc = subprocess.Popen(
                ["caffeinate", flags, "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            atexit.register(self.stop)
            if self.verbose:
                what = "절전·화면잠금 방지" if self.display else "절전 방지(화면은 꺼짐)"
                print(f"{what} ON — 작업 끝나면 자동 해제 "
                      f"(단, 노트북 뚜껑을 닫으면 무효)")
        except Exception as e:
            print(f"절전 방지 실패(작업은 계속): {e}")
        return self

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()
        self.proc = None

    def __exit__(self, *exc):
        self.stop()
        if self.enabled and self.verbose and sys.platform == "darwin":
            print("절전 방지 OFF")
        return False


def is_active(pid=None):
    """'우리가 건' 절전 억제가 살아있는지 확인 (검증용).

    시스템에 다른 caffeinate가 떠 있는 경우가 흔해서, 전체 assertion을 보면
    남의 것까지 잡힌다. 반드시 우리 PID 명의인지로 판별한다.
    """
    if sys.platform != "darwin":
        return False
    pid = pid or os.getpid()
    r = subprocess.run(["pmset", "-g", "assertions"], capture_output=True, text=True)
    return f"on behalf of Process ID {pid}" in r.stdout


if __name__ == "__main__":
    import time
    me = os.getpid()
    with KeepAwake():
        time.sleep(0.8)
        print("  내 명의 억제 걸림?", is_active(me))
    time.sleep(1.0)
    print("  해제 후 내 명의 남아있나?", is_active(me))
