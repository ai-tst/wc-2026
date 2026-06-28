"""Минималистичный тест-харнесс без внешних зависимостей (pytest на боксе нет).

Использование:
    from _harness import suite, eq, ok, run
    t = suite("Название набора")
    t.case("что проверяем", lambda: eq(actual, expected))
    run(t)  # вернёт кол-во провалов
"""
import sys
import traceback


class Suite:
    def __init__(self, name):
        self.name = name
        self.cases = []

    def case(self, name, fn):
        self.cases.append((name, fn))


def suite(name):
    return Suite(name)


class AssertionFail(Exception):
    pass


def eq(actual, expected, msg=""):
    if actual != expected:
        raise AssertionFail(f"{msg+': ' if msg else ''}ожидалось {expected!r}, получено {actual!r}")


def ok(cond, msg="условие ложно"):
    if not cond:
        raise AssertionFail(msg)


GREEN, RED, DIM, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def run(*suites):
    total = passed = 0
    failures = []
    for s in suites:
        print(f"\n{DIM}── {s.name} ──{RESET}")
        for name, fn in s.cases:
            total += 1
            try:
                fn()
                passed += 1
                print(f"  {GREEN}✓{RESET} {name}")
            except Exception as e:  # noqa: BLE001
                failures.append((s.name, name, e))
                print(f"  {RED}✗ {name}{RESET}")
                if not isinstance(e, AssertionFail):
                    print(f"    {DIM}{traceback.format_exc().strip().splitlines()[-1]}{RESET}")
                else:
                    print(f"    {RED}{e}{RESET}")
    failed = total - passed
    color = GREEN if failed == 0 else RED
    print(f"\n{color}{passed}/{total} прошло{RESET}")
    return failed


def main(*suites):
    sys.exit(1 if run(*suites) else 0)
