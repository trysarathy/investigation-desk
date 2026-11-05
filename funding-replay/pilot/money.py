"""Money as integer minor units plus an ISO currency. No floats anywhere."""

import re

EXPONENTS = {"SGD": 2, "USD": 2, "EUR": 2, "GBP": 2, "HKD": 2, "JPY": 0}

_PLAIN = re.compile(r"^(-?)(\d+)(?:\.(\d+))?$")
_GROUPED = re.compile(r"^(-?)(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$")


class MoneyError(ValueError):
    """Invalid amount or currency."""


class CurrencyMismatch(MoneyError):
    """Arithmetic or comparison across currencies."""


def check_currency(code):
    if not isinstance(code, str) or code.upper() != code or code not in EXPONENTS:
        raise MoneyError("Unknown currency %r; use one of %s." % (code, ", ".join(sorted(EXPONENTS))))
    return code


class Money(object):
    __slots__ = ("minor", "currency")

    def __init__(self, minor, currency):
        if isinstance(minor, bool) or not isinstance(minor, int):
            raise MoneyError("Money minor units must be an integer.")
        object.__setattr__(self, "minor", minor)
        object.__setattr__(self, "currency", check_currency(currency))

    def __setattr__(self, k, v):
        raise AttributeError("Money is immutable")

    def _same(self, other):
        if not isinstance(other, Money):
            raise TypeError("Money can only be combined with Money")
        if other.currency != self.currency:
            raise CurrencyMismatch("Cannot combine %s with %s." % (self.currency, other.currency))

    def __add__(self, other):
        self._same(other)
        return Money(self.minor + other.minor, self.currency)

    def __sub__(self, other):
        self._same(other)
        return Money(self.minor - other.minor, self.currency)

    def __neg__(self):
        return Money(-self.minor, self.currency)

    def __eq__(self, other):
        return isinstance(other, Money) and other.currency == self.currency and other.minor == self.minor

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash((self.minor, self.currency))

    def __lt__(self, other):
        self._same(other)
        return self.minor < other.minor

    def __le__(self, other):
        self._same(other)
        return self.minor <= other.minor

    def __gt__(self, other):
        self._same(other)
        return self.minor > other.minor

    def __ge__(self, other):
        self._same(other)
        return self.minor >= other.minor

    def is_zero(self):
        return self.minor == 0

    def amount_str(self, grouped=True):
        return amount_text(self.minor, self.currency, grouped)

    def __str__(self):
        return format_money(self)

    def __repr__(self):
        return "Money(%d, %r)" % (self.minor, self.currency)

    def to_json(self):
        return {"minor": self.minor, "currency": self.currency, "text": format_money(self)}


def zero(currency):
    return Money(0, currency)


def amount_text(minor, currency, grouped=True):
    exp = EXPONENTS[check_currency(currency)]
    sign = "-" if minor < 0 else ""
    m = abs(minor)
    whole, frac = divmod(m, 10 ** exp) if exp else (m, 0)
    w = "{:,}".format(whole) if grouped else str(whole)
    return sign + (w + "." + str(frac).rjust(exp, "0") if exp else w)


def format_money(m):
    return "%s %s" % (m.currency, amount_text(m.minor, m.currency))


def parse(text, currency, allow_negative=False, allow_zero=True):
    """Parse a decimal string ("48,250.00") into Money. Rejects floats, exponents and extra decimals."""
    check_currency(currency)
    if isinstance(text, bool) or isinstance(text, float):
        raise MoneyError("Amounts must be decimal strings such as \"1,250.00\", not numbers.")
    if isinstance(text, int):
        text = str(text)
    if not isinstance(text, str):
        raise MoneyError("Amount is required as a decimal string such as \"1,250.00\".")
    s = text.strip()
    if s.upper().startswith(currency + " "):
        s = s[len(currency) + 1:].strip()
    m = _PLAIN.match(s) or _GROUPED.match(s)
    if not m:
        raise MoneyError("%r is not a valid amount; write it like \"1,250.00\"." % text)
    neg, whole, frac = m.group(1), m.group(2).replace(",", ""), m.group(3) or ""
    exp = EXPONENTS[currency]
    if len(frac) > exp:
        raise MoneyError("%s allows %d decimal place%s; %r has %d." % (currency, exp, "" if exp == 1 else "s", text, len(frac)))
    minor = int(whole) * (10 ** exp) + (int(frac.ljust(exp, "0")) if exp else 0)
    if neg:
        minor = -minor
    if minor < 0 and not allow_negative:
        raise MoneyError("Amount must not be negative.")
    if minor == 0 and not allow_zero:
        raise MoneyError("Amount must be greater than zero.")
    return Money(minor, currency)
