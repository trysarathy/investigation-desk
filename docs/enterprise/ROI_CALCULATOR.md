# ROI calculator

Every input is editable. The default values below are **[ASSUMPTION]** placeholders, not measurements: no customer
has used Clearline yet, so replace them with your own numbers. The time-saved percentages are our guesses and are
exactly what a pilot should measure.

## Inputs

| Symbol | Input | Default | Label |
|---|---|---|---|
| N | Stablecoin payments received per month | 200 | [ASSUMPTION] |
| p | Share that arrive wrong (short, wrong network, fake token, no reference, duplicate) | 10% | [ASSUMPTION] |
| Me | Minutes to sort out one wrong payment today (find it, diagnose, reply, fix) | 45 | [ASSUMPTION] |
| Mp | Minutes to match and post one normal payment today | 6 | [ASSUMPTION] |
| H | Fully loaded hourly cost of the person doing it (US$) | 40 | [ASSUMPTION] |
| A | Hours of audit / month-end prep for stablecoin receipts per month | 6 | [ASSUMPTION] |
| Se | Share of exception time Clearline saves | 60% | [GUESS] |
| Sp | Share of matching-and-posting time saved (a person still approves each posting) | 50% | [GUESS] |
| Sa | Share of audit-prep time saved (tx hash, token, network and approver are on every posting) | 50% | [GUESS] |
| P | Clearline price per month (US$) | 200 | Offer price |

## Formula

```
Hours saved per month  = (N × p × Me × Se  +  N × (1 − p) × Mp × Sp) / 60  +  A × Sa
Value per month (US$)  = Hours saved × H
Net per month (US$)    = Value − P
Break-even payments    = the N at which Value = P
```

## Worked example (defaults)

- Exceptions: 200 × 10% × 45 × 60% = 540 minutes
- Normal payments: 200 × 90% × 6 × 50% = 540 minutes
- Total from payments: 1,080 minutes = **18.0 hours**
- Audit prep: 6 × 50% = **3.0 hours**
- **Hours saved: 21.0 a month** → 21.0 × US$40 = **US$840 a month value**, **US$640 net** of the US$200 price.

Break-even with these defaults: value per payment = (0.10 × 45 × 0.6 + 0.90 × 6 × 0.5) / 60 × 40 = US$3.60, plus
audit prep US$120 a month. So US$200 is covered at about **(200 − 120) / 3.60 ≈ 22 payments a month**.

## Sensitivity (what changes the answer)

| Change | Hours saved | Value | Net |
|---|---|---|---|
| Defaults | 21.0 | US$840 | US$640 |
| Only 50 payments a month | 7.5 | US$300 | US$100 |
| 2% arrive wrong (not 10%) | 14.6 | US$584 | US$384 |
| Clearline saves half what we guess (Se 30%, Sp 25%, Sa 25%) | 10.5 | US$420 | US$220 |
| 20 payments a month, 5% wrong, 2 h audit prep | 2.4 | US$96 | **−US$104** |

Honest reading: for a business with a few dozen stablecoin payments a month, the time saved is probably not worth
US$200. The case rests on volume, on how often payments arrive wrong, and on whether a wrong posting has ever cost
you more than the time. The pilot measures `Me`, `Mp`, `p` and the three savings shares on your real payments.
