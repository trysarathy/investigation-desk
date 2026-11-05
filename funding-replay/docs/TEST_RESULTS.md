# Test results (5 Nov 2026, branch funding-replay-parity)

All runs below were executed in this session on this checkout. Nothing is marked passed that did not run.

| Suite | Command | Result |
|---|---|---|
| Original experiment (reference, unchanged) | `python3 -I -m unittest -v` in the extracted ZIP (SHA-256 7cbab786…24a9d) | Ran 22 tests in 0.018s, OK |
| Rebuilt engine + server | `python3 -m unittest discover -s tests -v` | Ran 139 tests in 2.513s, OK |
| Browser (real `app/server.py`, Chromium) | `node tests/browser/e2e.cjs` | 123/123 checks passed |
| Comparison harness | `python3 parity/run.py` | exit 0; Totals over 19 scenarios x 3 as-of times x 14 fields: 692 same, 64 differs, 42 n/a. (differences reviewed in docs/PARITY_REVIEW.md) |

Baseline before changes (same session): original 22/22, rebuild 108/108, browser 100/100.

Browser checks include: the stale-Monday-balance screen (exact headline, 73 h 00 min, 24 h demo-policy limit, next action, no feasible chip, no comparison), Friday reference/pre-agreed leak checks (no 78.77, 88.77, 53.77 or Monday records in text, HTML, titles, aria or inputs), retrospective figures, 0%/8% sensitivity, delayed receivable, CSV import errors with row numbers, reset to 9 samples, switching retrospective/stale-balance back to Friday, no horizontal scroll at 1280/1366/1440, no non-local requests.

**Not verified:** real bank or provider data, real calendars or cutoffs, actual supplier credit, Safari/Firefox, the Mac launch itself (Python 3.9+ expected).

## Rebuilt engine + server (full list)
```
test_capacity_known_after_monday_instruction_withholds_retro (test_challenge.B1RetroUsesEachSlotsOwnEvidence.test_capacity_known_after_monday_instruction_withholds_retro) ... ok
test_framing_states_each_kinds_first_known_time (test_challenge.B1RetroUsesEachSlotsOwnEvidence.test_framing_states_each_kinds_first_known_time) ... ok
test_late_known_commitment_does_not_make_friday_infeasible_in_retro (test_challenge.B1RetroUsesEachSlotsOwnEvidence.test_late_known_commitment_does_not_make_friday_infeasible_in_retro) ... ok
test_quote_known_wednesday_withholds_retro (test_challenge.B1RetroUsesEachSlotsOwnEvidence.test_quote_known_wednesday_withholds_retro) ... ok
test_reference_framing_unchanged (test_challenge.B1RetroUsesEachSlotsOwnEvidence.test_reference_framing_unchanged) ... ok
test_monday_language_is_conditional (test_challenge.B2MondayIsCounterfactual.test_monday_language_is_conditional) ... ok
test_note_on_monday (test_challenge.B2MondayIsCounterfactual.test_note_on_monday) ... ok
test_forward_terms_without_bp (test_challenge.B3MissingSpreadIsUnknown.test_forward_terms_without_bp) ... ok
test_extra_cost_is_fees_only (test_challenge.B4DifferentRatesWithheld.test_extra_cost_is_fees_only) ... ok
test_monday_rate_differs (test_challenge.B4DifferentRatesWithheld.test_monday_rate_differs) ... ok
test_no_saves_wording_anywhere (test_challenge.B4DifferentRatesWithheld.test_no_saves_wording_anywhere) ... ok
test_names_and_descriptions_leak_nothing_known_after_friday (test_challenge.B5FridaySafeDescriptions.test_names_and_descriptions_leak_nothing_known_after_friday) ... ok
test_future_dated_settled_receivable_not_usable (test_challenge.B6FutureDatedSettledIsForecast.test_future_dated_settled_receivable_not_usable) ... ok
test_future_dated_snapshot_not_usable (test_challenge.B6FutureDatedSettledIsForecast.test_future_dated_snapshot_not_usable) ... ok
test_decimal_caps (test_challenge.M1LimitsAndServerErrors.test_decimal_caps) ... ok
test_max_size_values_evaluate (test_challenge.M1LimitsAndServerErrors.test_max_size_values_evaluate) ... ok
test_non_ascii_digits_in_timestamp_rejected (test_challenge.M1LimitsAndServerErrors.test_non_ascii_digits_in_timestamp_rejected) ... ok
test_server_rejects_unicode_digit_rate (test_challenge.M1LimitsAndServerErrors.test_server_rejects_unicode_digit_rate) ... ok
test_server_returns_json_500_on_engine_exception (test_challenge.M1LimitsAndServerErrors.test_server_returns_json_500_on_engine_exception) ... ok
test_conflicting_fee_is_contradictory (test_challenge.M2FeeTypes.test_conflicting_fee_is_contradictory) ... ok
test_fee_without_type_rejected (test_challenge.M2FeeTypes.test_fee_without_type_rejected) ... ok
test_fixture_fees_carry_type (test_challenge.M2FeeTypes.test_fixture_fees_carry_type) ... ok
test_restated_identical_fee_is_counted_once (test_challenge.M2FeeTypes.test_restated_identical_fee_is_counted_once) ... ok
test_late_observed_credit_fails_delivery (test_challenge.M3ObservedCreditOverridesBound.test_late_observed_credit_fails_delivery) ... ok
test_on_time_observed_credit_ok (test_challenge.M3ObservedCreditOverridesBound.test_on_time_observed_credit_ok) ... ok
test_monday_snapshots_in_fixtures (test_challenge.M4OldSnapshotIsStale.test_monday_snapshots_in_fixtures) ... ok
test_old_snapshot_unknown (test_challenge.M4OldSnapshotIsStale.test_old_snapshot_unknown) ... ok
test_delivery_check_renamed (test_challenge.MinorFixes.test_delivery_check_renamed) ... ok
test_obligation_must_be_positive (test_challenge.MinorFixes.test_obligation_must_be_positive) ... ok
test_retro_headlines (test_challenge.MinorFixes.test_retro_headlines) ... ok
test_risk_note (test_challenge.MinorFixes.test_risk_note) ... ok
test_friday_insufficient_forecast_not_counted (test_engine.DelayedReceivable.test_friday_insufficient_forecast_not_counted) ... ok
test_monday_short_5382_50 (test_engine.DelayedReceivable.test_monday_short_5382_50) ... ok
test_monday_view_excludes_tuesday_receipt (test_engine.DelayedReceivable.test_monday_view_excludes_tuesday_receipt) ... ok
test_retro_withheld_tuesday_cannot_finance_monday (test_engine.DelayedReceivable.test_retro_withheld_tuesday_cannot_finance_monday) ... ok
test_adding_later_records_cannot_change_friday (test_engine.EvidenceCutoff.test_adding_later_records_cannot_change_friday) ... ok
test_evidence_lists_only_visible_records (test_engine.EvidenceCutoff.test_evidence_lists_only_visible_records) ... ok
Serialise the whole response: no record known after as_of may appear. ... ok
test_all_eight_scenarios_present (test_engine.ExpectedOutcomesTable.test_all_eight_scenarios_present) ... ok
test_contract_top_level_shape (test_engine.ExpectedOutcomesTable.test_contract_top_level_shape) ... ok
test_friday_view_never_has_an_economic_figure (test_engine.ExpectedOutcomesTable.test_friday_view_never_has_an_economic_figure) ... ok
test_labels_on_every_response (test_engine.ExpectedOutcomesTable.test_labels_on_every_response) ... ok
test_monday_view_has_no_comparison (test_engine.ExpectedOutcomesTable.test_monday_view_has_no_comparison) ... ok
test_retro_comparison_available_or_withheld (test_engine.ExpectedOutcomesTable.test_retro_comparison_available_or_withheld) ... ok
test_states_match_contract_table (test_engine.ExpectedOutcomesTable.test_states_match_contract_table) ... ok
test_bad_decimal (test_engine.LoaderBehaviour.test_bad_decimal) ... ok
test_bad_timestamp (test_engine.LoaderBehaviour.test_bad_timestamp) ... ok
test_column_order_free (test_engine.LoaderBehaviour.test_column_order_free) ... ok
test_conflicting_record_id_rejected (test_engine.LoaderBehaviour.test_conflicting_record_id_rejected) ... ok
test_duplicate_rows_are_dropped_and_output_unchanged (test_engine.LoaderBehaviour.test_duplicate_rows_are_dropped_and_output_unchanged) ... ok
test_empty_and_header_only (test_engine.LoaderBehaviour.test_empty_and_header_only) ... ok
test_fixtures_load_and_are_labelled_synthetic (test_engine.LoaderBehaviour.test_fixtures_load_and_are_labelled_synthetic) ... ok
test_missing_columns (test_engine.LoaderBehaviour.test_missing_columns) ... ok
test_missing_required_field (test_engine.LoaderBehaviour.test_missing_required_field) ... ok
test_scenarios_json (test_engine.LoaderBehaviour.test_scenarios_json) ... ok
test_timestamp_without_offset (test_engine.LoaderBehaviour.test_timestamp_without_offset) ... ok
test_unknown_kind_slot_status (test_engine.LoaderBehaviour.test_unknown_kind_slot_status) ... ok
test_wrong_currency (test_engine.LoaderBehaviour.test_wrong_currency) ... ok
test_wrong_field_count (test_engine.LoaderBehaviour.test_wrong_field_count) ... ok
test_closed_day (test_engine.OtherIncidents.test_closed_day) ... ok
test_concurrent_payout (test_engine.OtherIncidents.test_concurrent_payout) ... ok
test_low_capacity (test_engine.OtherIncidents.test_low_capacity) ... ok
test_simulated_bound_is_not_delivery (test_engine.OtherIncidents.test_simulated_bound_is_not_delivery) ... ok
test_slow_credit (test_engine.OtherIncidents.test_slow_credit) ... ok
test_stale_quote (test_engine.OtherIncidents.test_stale_quote) ... ok
test_deterministic_and_pure (test_engine.PlainEnglish.test_deterministic_and_pure) ... ok
test_no_banned_phrases_in_actions_and_reasons (test_engine.PlainEnglish.test_no_banned_phrases_in_actions_and_reasons) ... ok
test_friday_manual_review (test_engine.PreagreedWalkthrough.test_friday_manual_review) ... ok
test_friday_shows_no_figure_but_lists_cost_questions (test_engine.PreagreedWalkthrough.test_friday_shows_no_figure_but_lists_cost_questions) ... ok
test_monday_and_retro (test_engine.PreagreedWalkthrough.test_monday_and_retro) ... ok
test_retro_reservation_cost_is_paid_by_the_importer (test_engine.PreagreedWalkthrough.test_retro_reservation_cost_is_paid_by_the_importer) ... ok
test_bad_rate_and_time_rejected (test_engine.RateIsOnlyAnAssumption.test_bad_rate_and_time_rejected) ... ok
test_float_rate_rejected (test_engine.RateIsOnlyAnAssumption.test_float_rate_rejected) ... ok
test_no_float_in_engine_source (test_engine.RateIsOnlyAnAssumption.test_no_float_in_engine_source) ... ok
test_rate_changes_the_carry (test_engine.RateIsOnlyAnAssumption.test_rate_changes_the_carry) ... ok
test_rate_never_changes_anything_else (test_engine.RateIsOnlyAnAssumption.test_rate_never_changes_anything_else) ... ok
test_friday_contains_nothing_known_later (test_engine.ReferenceWalkthrough.test_friday_contains_nothing_known_later) ... ok
test_friday_keep_friday (test_engine.ReferenceWalkthrough.test_friday_keep_friday) ... ok
test_friday_option_numbers (test_engine.ReferenceWalkthrough.test_friday_option_numbers) ... ok
test_funding_cost_formula_follows_rate (test_engine.ReferenceWalkthrough.test_funding_cost_formula_follows_rate) ... ok
test_monday_feasible (test_engine.ReferenceWalkthrough.test_monday_feasible) ... ok
test_not_evidenced_option_has_no_numbers (test_engine.ReferenceWalkthrough.test_not_evidenced_option_has_no_numbers) ... ok
test_retro_at_zero_rate (test_engine.ReferenceWalkthrough.test_retro_at_zero_rate) ... ok
test_retro_hindsight_numbers_at_8pct (test_engine.ReferenceWalkthrough.test_retro_hindsight_numbers_at_8pct) ... ok
test_retro_monday_feasible_friday_feasible (test_engine.ReferenceWalkthrough.test_retro_monday_feasible_friday_feasible) ... ok
test_times_and_payment (test_engine.ReferenceWalkthrough.test_times_and_payment) ... ok
test_money_rounding_half_up (test_engine.TimeFormatting.test_money_rounding_half_up) ... ok
test_ny_dst_and_fallback (test_engine.TimeFormatting.test_ny_dst_and_fallback) ... ok
test_beneficiary_credit_observed_only_with_record (test_engine.UnknownNeverAssumed.test_beneficiary_credit_observed_only_with_record) ... ok
test_contradictory_calendar_is_unknown (test_engine.UnknownNeverAssumed.test_contradictory_calendar_is_unknown) ... ok
test_contradictory_friday_quotes_are_unknown (test_engine.UnknownNeverAssumed.test_contradictory_friday_quotes_are_unknown) ... ok
test_contradictory_monday_quotes_withhold_retro (test_engine.UnknownNeverAssumed.test_contradictory_monday_quotes_withhold_retro) ... ok
test_indicative_capacity_is_not_feasible (test_engine.UnknownNeverAssumed.test_indicative_capacity_is_not_feasible) ... ok
test_missing_cash_floor_is_unknown (test_engine.UnknownNeverAssumed.test_missing_cash_floor_is_unknown) ... ok
test_missing_obligation (test_engine.UnknownNeverAssumed.test_missing_obligation) ... ok
test_backdated_monday_balance_first_received_tuesday (test_parity.P1BalanceAge24h.test_backdated_monday_balance_first_received_tuesday) ... ok
test_earlier_expiry_still_applies (test_parity.P1BalanceAge24h.test_earlier_expiry_still_applies) ... ok
test_exactly_24h_is_accepted (test_parity.P1BalanceAge24h.test_exactly_24h_is_accepted) ... ok
test_fresh_monday_snapshot (test_parity.P1BalanceAge24h.test_fresh_monday_snapshot) ... ok
test_freshness_is_judged_at_the_slot_not_when_retro_opens (test_parity.P1BalanceAge24h.test_freshness_is_judged_at_the_slot_not_when_retro_opens) ... ok
test_just_over_24h_is_stale (test_parity.P1BalanceAge24h.test_just_over_24h_is_stale) ... ok
test_missing_snapshot (test_parity.P1BalanceAge24h.test_missing_snapshot) ... ok
test_rate_never_changes_the_balance_answer (test_parity.P1BalanceAge24h.test_rate_never_changes_the_balance_answer) ... ok
test_stale_monday_balance_screen (test_parity.P1BalanceAge24h.test_stale_monday_balance_screen) ... ok
test_cash_support_must_cover_required_plus_reservation (test_parity.P2ForwardCashSupport.test_cash_support_must_cover_required_plus_reservation) ... ok
test_preagreed_is_manual_review_only (test_parity.P2ForwardCashSupport.test_preagreed_is_manual_review_only) ... ok
test_preagreed_without_cash_support_keeps_friday (test_parity.P2ForwardCashSupport.test_preagreed_without_cash_support_keeps_friday) ... ok
test_reference_friday_lists_cash_support_as_missing (test_parity.P2ForwardCashSupport.test_reference_friday_lists_cash_support_as_missing) ... ok
test_capacity_ending_before_release_is_not_evidence (test_parity.P3RouteChecks.test_capacity_ending_before_release_is_not_evidence) ... ok
test_fallback_must_cover_net_amount (test_parity.P3RouteChecks.test_fallback_must_cover_net_amount) ... ok
test_instruction_at_cutoff_is_infeasible_even_in_retro (test_parity.P3RouteChecks.test_instruction_at_cutoff_is_infeasible_even_in_retro) ... ok
test_missing_processing_fee_is_unknown_not_cheaper (test_parity.P3RouteChecks.test_missing_processing_fee_is_unknown_not_cheaper) ... ok
test_spread_difference_withholds_comparison (test_parity.P3RouteChecks.test_spread_difference_withholds_comparison) ... ok
test_tuesday_closure_loses_monday_lead (test_parity.P3RouteChecks.test_tuesday_closure_loses_monday_lead) ... ok
test_commitment_after_balance_is_deducted_once (test_parity.P4Commitments.test_commitment_after_balance_is_deducted_once) ... ok
test_commitment_already_paid_before_balance_is_not_deducted_again (test_parity.P4Commitments.test_commitment_already_paid_before_balance_is_not_deducted_again) ... ok
test_missing_commitment_list_makes_cash_unknown (test_parity.P4Commitments.test_missing_commitment_list_makes_cash_unknown) ... ok
test_b1_cost_known_after_instruction_withholds_retro_figure (test_parity.P5AdversarialFindings.test_b1_cost_known_after_instruction_withholds_retro_figure) ... ok
test_b2_monday_checkpoint_never_uses_friday_cash_support (test_parity.P5AdversarialFindings.test_b2_monday_checkpoint_never_uses_friday_cash_support) ... ok
test_b3_future_dated_commitment_list_is_not_evidence (test_parity.P5AdversarialFindings.test_b3_future_dated_commitment_list_is_not_evidence) ... ok
test_capacity_expiring_exactly_at_release_is_not_through_release (test_parity.P5AdversarialFindings.test_capacity_expiring_exactly_at_release_is_not_through_release) ... ok
test_m1_closure_with_empty_slot_applies_to_both_slots (test_parity.P5AdversarialFindings.test_m1_closure_with_empty_slot_applies_to_both_slots) ... ok
test_m2_fallback_starting_after_the_slot_is_not_a_fallback (test_parity.P5AdversarialFindings.test_m2_fallback_starting_after_the_slot_is_not_a_fallback) ... ok
test_m3_cash_support_older_than_a_known_commitment_is_stale (test_parity.P5AdversarialFindings.test_m3_cash_support_older_than_a_known_commitment_is_stale) ... ok
test_same_receipt_under_two_ids_is_not_counted_twice (test_parity.P5AdversarialFindings.test_same_receipt_under_two_ids_is_not_counted_twice) ... ok
test_from_project_dir (test_server.LaunchCommands.test_from_project_dir) ... ok
test_from_repo_root (test_server.LaunchCommands.test_from_repo_root) ... ok
test_body_over_1mb_rejected (test_server.ServerTest.test_body_over_1mb_rejected) ... ok
test_evaluate_bad_inputs (test_server.ServerTest.test_evaluate_bad_inputs) ... ok
test_evaluate_friday_has_no_monday_leak (test_server.ServerTest.test_evaluate_friday_has_no_monday_leak) ... ok
test_evaluate_matches_engine (test_server.ServerTest.test_evaluate_matches_engine) ... ok
test_foreign_origin_and_host_rejected (test_server.ServerTest.test_foreign_origin_and_host_rejected) ... ok
test_import_conflicting_ids_rejected (test_server.ServerTest.test_import_conflicting_ids_rejected) ... ok
test_import_error_when_nothing_imported_keeps_samples (test_server.ServerTest.test_import_error_when_nothing_imported_keeps_samples) ... ok
test_import_good_then_bad_keeps_last_good_then_reset (test_server.ServerTest.test_import_good_then_bad_keeps_last_good_then_reset) ... ok
test_index_and_static (test_server.ServerTest.test_index_and_static) ... ok
test_meta (test_server.ServerTest.test_meta) ... ok
test_other_methods_rejected (test_server.ServerTest.test_other_methods_rejected) ... ok
Ran 139 tests in 2.513s
OK
```

## Browser
```
Server: real (app/server.py) on port 34071
PASS banner label present
PASS footer label present
PASS net amount shown
PASS deadline SGT shown
PASS deadline New York shown
PASS as-of time shown
PASS Friday headline "Keep Friday’s funding window"
PASS net, deadlines, headline, reason above the fold at 1366x768
PASS release checkpoint + "Provider release is not supplier credit"
PASS beneficiary credit "not observed"
PASS assumption control labelled
PASS Friday reference excludes "78.77"
PASS Friday reference excludes "88.77"
PASS Friday reference excludes "Mon 16 Nov 2026, 09:00"
PASS Friday reference excludes "135,382.50"
PASS Friday reference excludes "59.18"
PASS Friday reference excludes "9,000.00"
PASS Friday reference excludes "270,000"
PASS Friday reference excludes "405,000"
PASS Friday reference excludes "13,500.00"
PASS Friday Monday option is "Not evidenced"
PASS Friday reference shows no comparison block
PASS Friday reference: delivery check "Simulated delivery bound (not observed)"
PASS Friday reference: no decision-time note
PASS 9 scenarios in the list
PASS Scenario names from engine (new names present)
PASS Retro shows "5 days"
PASS Retro shows "2 days"
PASS Retro shows "405,000"
PASS Retro shows "88.77"
PASS Retro shows "10.00"
PASS Retro shows "78.77"
PASS Retro shows "not observed"
PASS Retro comparison framed as hindsight only
PASS Retro comparison shows formula
PASS Retro shows risk note "A missed deadline can swamp either figure."
PASS Retro reference headline (hindsight, not supported on Friday)
PASS Retro shows per-slot hindsight note
PASS Retro note, headline and reason above the fold at 1366x768
PASS Monday view shows "Counterfactual" tag
PASS Monday note quotes the Friday decision
PASS Monday headline says "would have been"
PASS Monday action: do not instruct the same payment again
PASS Monday counterfactual note, headline, reason, net and deadline above the fold at 1366x768
PASS Back to Friday removes "78.77"
PASS Back to Friday removes "88.77"
PASS Back to Friday removes "Mon 16 Nov 2026, 09:00"
PASS Back to Friday removes "135,382.50"
PASS Back to Friday removes "59.18"
PASS Back to Friday removes "9,000.00"
PASS Back to Friday removes "270,000"
PASS Back to Friday removes "405,000"
PASS Back to Friday removes "13,500.00"
PASS Back to Friday: no comparison block
PASS 0% shows −10.00
PASS 0% shows "SGD 10.00 more"
PASS 0% quick button pressed
PASS rate change does not change decision headline
PASS 8% typed restores 78.77
PASS Delayed receivable Monday shows "130,000.00"
PASS Delayed receivable Monday shows "135,382.50"
PASS Delayed receivable Monday shows "5,382.50"
PASS Delayed receivable Monday: no actionable comparison shown
PASS Delayed receivable Monday headline reports insufficient cash
PASS Delayed receivable Monday: Counterfactual note + no-double-instruction action
PASS Delayed receivable Monday decision tone is red
PASS Scenario switch kept decision time (Monday)
PASS Delayed receivable Retro: "Comparison withheld" + reason
PASS Delayed receivable Retro: no savings figures
PASS Preagreed Friday headline "Manual review"
PASS Preagreed Friday headline is exactly "Manual review before waiting"
PASS Preagreed Friday next actions ask about the reservation cost
PASS Preagreed Friday shows no comparison block (Friday never has one)
PASS Preagreed Friday excludes "53.77"
PASS Preagreed Friday excludes "88.77"
PASS Preagreed Friday: no "Conditional" comparison heading
PASS Preagreed Friday scenario switch kept Friday
PASS Stale balance Monday headline exact
PASS Stale balance Monday: balance panel shows "Fri 13 Nov 2026, 14:00 SGT"
PASS Stale balance Monday: balance panel shows balance id CASH-FRI
PASS Stale balance Monday: balance panel shows age "73 h 00 min"
PASS Stale balance Monday: balance panel shows limit "24 h before the funding slot (demo policy)"
PASS Stale balance Monday: balance panel labels
PASS Stale balance Monday: next action shown in the panel
PASS Stale balance Monday: Monday option is not "Feasible"
PASS Stale balance Monday: no "Feasible" chip anywhere
PASS Stale balance Monday: no comparison block
PASS Stale balance Monday: decision tone is amber (never green)
PASS Stale balance Monday: banner label still visible
PASS Stale balance Monday: headline, reason and balance panel above the fold at 1366x768
PASS Stale balance Monday: panel sits directly under the reason
PASS Stale balance Monday → Friday removes "73 h 00 min"
PASS Stale balance Monday → Friday removes "Age at the Monday slot"
PASS Stale balance Friday: no balance panel and no comparison
PASS Scenario switch kept decision time (Retrospective)
PASS Invalid CSV shows row-numbered errors
PASS Invalid CSV: row errors formatted "Row N, column C: message"
PASS Invalid CSV keeps previous scenario
PASS After failed import, evaluate still uses reference
PASS Valid CSV import accepted (reference.csv)
PASS Imported scenario selected
PASS Reset restores the 9 samples (no imported)
PASS Reset leaves a sample scenario selected
PASS Evidence button focuses the evidence trail
PASS Evidence table has the required columns
PASS Arrow key moves decision time to Monday
PASS No "saves"/"savings" (or stray null/undefined) text in any scenario or decision time (9 x 3 views)
PASS Every Monday view is labelled Counterfactual with the no-double-instruction action
PASS No horizontal scroll at 1280x800 (friday)
PASS No clipped amounts at 1280x800 (friday)
PASS No horizontal scroll at 1280x800 (retro)
PASS No clipped amounts at 1280x800 (retro)
PASS No horizontal scroll at 1366x768 (friday)
PASS No clipped amounts at 1366x768 (friday)
PASS No horizontal scroll at 1366x768 (retro)
PASS No clipped amounts at 1366x768 (retro)
PASS No horizontal scroll at 1440x900 (friday)
PASS No clipped amounts at 1440x900 (friday)
PASS No horizontal scroll at 1440x900 (retro)
PASS No clipped amounts at 1440x900 (retro)
PASS Key facts above the fold at 1280x800
PASS No request to any non-local host
PASS No page errors

123/123 checks passed
```

## Original experiment
```
test_baseline (test_replay.Tests.test_baseline) ... ok
test_capacity (test_replay.Tests.test_capacity) ... ok
test_concurrent (test_replay.Tests.test_concurrent) ... ok
test_conflict (test_replay.Tests.test_conflict) ... ok
test_cutoff (test_replay.Tests.test_cutoff) ... ok
test_destination_missing (test_replay.Tests.test_destination_missing) ... ok
test_destination_slow (test_replay.Tests.test_destination_slow) ... ok
test_duplicate (test_replay.Tests.test_duplicate) ... ok
test_early_replay (test_replay.Tests.test_early_replay) ... ok
test_forecast (test_replay.Tests.test_forecast) ... ok
test_forward_after_deadline (test_replay.Tests.test_forward_after_deadline) ... ok
test_future (test_replay.Tests.test_future) ... ok
test_holiday (test_replay.Tests.test_holiday) ... ok
test_html (test_replay.Tests.test_html) ... ok
test_missing (test_replay.Tests.test_missing) ... ok
test_order (test_replay.Tests.test_order) ... ok
test_preagreed (test_replay.Tests.test_preagreed) ... ok
test_prior_choice (test_replay.Tests.test_prior_choice) ... ok
test_receivable_late (test_replay.Tests.test_receivable_late) ... ok
test_scenarios (test_replay.Tests.test_scenarios) ... ok
test_stale (test_replay.Tests.test_stale) ... ok
test_weekend (test_replay.Tests.test_weekend) ... ok

----------------------------------------------------------------------
Ran 22 tests in 0.018s

OK
```

## Tester edition (5 Nov 2026, branch funding-tester)
| Check | Result |
|---|---|
| Engine + server tests | Ran 139 tests in 2.257s, OK |
| Development app browser checks (`node tests/browser/e2e.cjs`) | 123/123 checks passed |
| Recipient checks on the unzipped ZIP, file:// and static HTTP (`node tests/browser/recipient.cjs`) | 48/48 recipient checks passed |
| Offline check (`node tests/browser/offline.cjs`) | all 54 scenario/checkpoint/preset states passed; no remote requests or browser errors |

Recipient checks cover: the first screen above the fold at 1366×768 (route, USD 100,000.00 net, deadline SGT + New York, decision time, headline, banner); the Friday reference with no 78.77/88.77/Monday records anywhere (page, attributes, evidence); retrospective 8% (5 vs 2 days, 405,000 SGD-days, 88.77 − 10.00 = 78.77, hindsight label, no "saving") and 0% (waiting costs SGD 10.00 more); Friday → retrospective → Friday clearing; delayed receipt (130,000.00 vs 135,382.50, short 5,382.50; Tuesday receipt cannot finance Monday); stale balance (73 h 00 min vs 24 h demo policy, not short); pre-agreed Manual review with no figure; simulated delivery never a green tick; all 54 states without clipped amounts; keyboard arrow navigation and focus ring; WCAG AA text contrast on key elements; 390 px phone width without horizontal scroll; no remote requests; no browser errors; no CSV/Data panel.

Not verified: Safari, Firefox or Edge; a real Mac or Windows machine; screen readers; any hosted URL (not hosted).
