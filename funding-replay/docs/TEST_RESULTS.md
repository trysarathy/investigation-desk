# Test results (3 Nov 2026, this checkout)

Baseline: the original replay package (test_replay.py, 22 tests) was not supplied, so 0 baseline tests could be run.

## Engine + server: `python3 -m unittest discover -s tests -v`
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
test_duplicate_fee_under_new_id_is_contradictory (test_challenge.M2FeeTypes.test_duplicate_fee_under_new_id_is_contradictory) ... ok
test_fee_without_type_rejected (test_challenge.M2FeeTypes.test_fee_without_type_rejected) ... ok
test_fixture_fees_carry_type (test_challenge.M2FeeTypes.test_fixture_fees_carry_type) ... ok
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
test_friday_comparison_only_for_manual_review (test_engine.ExpectedOutcomesTable.test_friday_comparison_only_for_manual_review) ... ok
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
test_friday_comparison_conditional_with_reservation_cost (test_engine.PreagreedWalkthrough.test_friday_comparison_conditional_with_reservation_cost) ... ok
test_friday_manual_review (test_engine.PreagreedWalkthrough.test_friday_manual_review) ... ok
test_monday_and_retro (test_engine.PreagreedWalkthrough.test_monday_and_retro) ... ok
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
Ran 108 tests in 1.934s
OK
```

## Browser: `node tests/browser/e2e.cjs` (real server, Chromium)
```
Server: real (app/server.py) on port 40779
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
PASS Preagreed Friday comparison is conditional
PASS Preagreed Friday scenario switch kept Friday
PASS Scenario switch kept decision time (Retrospective)
PASS Invalid CSV shows row-numbered errors
PASS Invalid CSV: row errors formatted "Row N, column C: message"
PASS Invalid CSV keeps previous scenario
PASS After failed import, evaluate still uses reference
PASS Valid CSV import accepted (reference.csv)
PASS Imported scenario selected
PASS Reset restores the 8 samples (no imported)
PASS Reset leaves a sample scenario selected
PASS Evidence button focuses the evidence trail
PASS Evidence table has the required columns
PASS Arrow key moves decision time to Monday
PASS No "saves"/"savings" (or stray null/undefined) text in any scenario or decision time (8 x 3 views)
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

100/100 checks passed
```
