"""Pure grandMA3 console command builders.

No third-party imports, no I/O. Every function validates its typed
arguments and returns the console command string, or raises ValueError.
"""
import re

_MAX = 99999
# Names: the Label help page forbids \ " $ & * ? , . ; ^ { | } ~, and '-' / '+' act as selection operators: keep plain words only.
_NAME_RE = re.compile(r"[A-Za-z0-9 _]{1,32}")
_ADDRESS_RE = re.compile(r"[0-9]{1,3}\.[0-9]{1,3}")
# Object kinds are an allowlist (free text would let a caller append a second command part).
SELECT_KINDS = ("Page", "Executor", "Sequence")
LABEL_KINDS = ("Group", "Fixture", "Sequence")


def _check_int(value, what, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{what} must be an int, got {type(value).__name__}")
    if value < minimum:
        raise ValueError(f"{what} must be >= {minimum}, got {value}")
    if value > _MAX:
        raise ValueError(f"{what} must be <= {_MAX}, got {value}")
    return value


def _check_name(value, what):
    if isinstance(value, str) and _NAME_RE.fullmatch(value):
        collapsed = " ".join(value.split())
        if collapsed:
            return collapsed
    raise ValueError(f"{what} must be 1-32 characters of letters, digits, space or underscore")


def _check_kind(value, allowed, what):
    if value in allowed:
        return value
    raise ValueError(f"{what} must be one of {allowed}")


def _check_address(value):
    if isinstance(value, str) and _ADDRESS_RE.fullmatch(value):
        return value
    raise ValueError("address must look like <universe>.<address>, e.g. 1.101")


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_select.html  (Select [Object] [num])
def cmd_select(kind, number):
    _check_kind(kind, SELECT_KINDS, "select kind")
    _check_int(number, "number", 1)
    return f"Select {kind} {number}"


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_goplus.html  (Go+ Executor 101)
def cmd_executor_go(executor):
    _check_int(executor, "executor", 1)
    return f"Go+ Executor {executor}"


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_gominus.html  (Go- Executor 101)
def cmd_executor_back(executor):
    _check_int(executor, "executor", 1)
    return f"Go- Executor {executor}"


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_pause.html  (Pause Executor 201)
def cmd_executor_pause(executor):
    _check_int(executor, "executor", 1)
    return f"Pause Executor {executor}"


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_off.html  (Off [Object] [num])
def cmd_executor_off(executor):
    _check_int(executor, "executor", 1)
    return f"Off Executor {executor}"


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_goto.html  (Goto Cue 105 Executor 104)
def cmd_goto_cue(cue, executor=None):
    _check_int(cue, "cue", 1)
    if executor is None:
        return f"Goto Cue {cue}"
    _check_int(executor, "executor", 1)
    return f"Goto Cue {cue} Executor {executor}"


# https://help.malighting.com/grandMA3/2.5/HTML/cue_store.html  (Store Cue 2 Sequence 4)
def cmd_store_cue(cue, sequence=None, executor=None):
    _check_int(cue, "cue", 1)
    parts = [f"Store Cue {cue}"]
    if sequence is not None:
        _check_int(sequence, "sequence", 1)
        parts.append(f"Sequence {sequence}")
    if executor is not None:
        _check_int(executor, "executor", 1)
        parts.append(f"Executor {executor}")
    return " ".join(parts)


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_label.html  (Label [Object] [num] ["Name"])
def cmd_label(kind, number, name):
    _check_kind(kind, LABEL_KINDS, "label kind")
    _check_int(number, "number", 1)
    name = _check_name(name, "label name")
    return f'Label {kind} {number} "{name}"'


# https://help.malighting.com/grandMA3/2.4/HTML/keyword_clear.html  (Clear)
def cmd_clear():
    return "Clear"


# https://help.malighting.com/grandMA3/2.3/HTML/keyword_goplus.html  (Go+ Macro 2; "Go Macro" is the documented shortcut)
def cmd_macro(number):
    _check_int(number, "macro", 1)
    return f"Go+ Macro {number}"


# https://help.malighting.com/grandMA3/2.5/HTML/keyword_patch.html  (Patch Fixture 2 3.123)
def cmd_patch_fixture(fixture_id, address):
    _check_int(fixture_id, "fixture_id", 1)
    _check_address(address)
    return f"Patch Fixture {fixture_id} {address}"
