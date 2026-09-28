# Sandbox conformance audit

Reference: Python SDK 1.9.1 (`c36d3d999e06dded1d773cf74e8202bc12e70af0`). Audit date: 2026-09-28.

The inventory below classifies every test function in the selected sandbox/shared-transport reference modules, plus the sandbox portions of the public typing suites. Parameterized and sync/async variants map to Node Promise behavior. This is a scenario-to-suite map, not a claim of exhaustive branch coverage or proof for all possible inputs.

Live volume tests are excluded at the user’s request; their local contracts remain tested. Browser/web/agent features and Python-only legacy model compatibility remain outside this work.

## Validation results

- 646 Node local tests pass, plus source/test typechecking, lint, and an installed
  packed-package check for CommonJS, ESM, exported subpaths and TypeScript consumers.
- 84 live tests pass on dev and 84 on production, excluding live volumes by request.
  Temporary production credentials and test-owned resources are cleaned up.
- 505 selected Python reference cases pass. The stream-timeout fixture was run from
  an external copy with only its server binding changed to IPv6 loopback; no Python
  SDK or assertion logic was changed. Other reference modules ran unchanged.
- An SDK-independent node-fetch probe reproduced intermittent IPv4 connections
  that never reached the fixture server (5 failures in 400 attempts), while IPv6
  had zero in 200 attempts. Node's local HTTP fixtures now use IPv6 loopback.
  Ten consecutive socket-suite runs passed, covering 820 test executions at that
  stage of the audit; the final expanded suite also passes.
- The CI matrix covers Linux Node 20.20.2/22.22.1/24.15.0 and macOS 14 Node 24.15.0.
  Windows and additional real Docker versions are not established by these tests.

The new comparisons exposed and fixed Unicode wildcard/JSON identity differences,
loss of literal `__proto__` environment keys, inherited-property process stream
names, missing process timestamp aliases, terminal keepalive handling, pagination
and image format/platform validation, and empty network error diagnostics. A live
terminal resize assertion now waits for the receiver to apply the WebSocket message;
local send completion cannot guarantee an immediate HTTP read sees the update.

## Repeatable comparison

- `tests/parity/export_python_reference.py` regenerates Docker ignore/analysis, image identity/initialization, filesystem fingerprint, and process event fixtures from the actual pinned Python code.
- `tests/parity/export_wire_reference.py` captures real Python SDK request and response behavior for both sync and async clients. Node executes those scenarios through real local HTTP connections.
- `tests/parity/export_sse_reference.py` runs the actual Python sync/async SSE transports over the same byte sequences used by Node.
- All generators require the pinned Python revision and make no network requests. Run them with that checkout’s virtualenv interpreter and the checkout path as their argument. Regenerated fixtures are checked into `tests/fixtures`; normal Node CI requires no Python installation.
- `tests/parity/scenario-map.json` contains the machine-readable inventory, source line numbers, collected variant counts, and suite paths.

## Intentional representations and validation differences

- Node uses camelCase options, Promises, `Buffer`, `Date` for file timestamps, and strings for control-plane timestamps. Python sync/async entry points, datetime objects and Pydantic instances are not Node APIs.
- Node uses TypeScript request/response unions rather than Pydantic runtime validation of every returned object. Launch source/resource validation, image format/platform validation, pagination bounds, and output-limit checks run in JavaScript too.
- Error classes/messages are native to each language. Node exposes structured `method`/`path`, removes host/query credentials from that path, and reports cancellation as `request_aborted`.
- Runtime boolean query values are `true`/`false` in Node and `True`/`False` in Python; the receiver accepts both. Node avoids Python’s redundant detail GET when expose already returns a URL.
- Node keeps its existing gVisor declarations, callback watch adapter, buffered file overloads, and explicit local Docker tag ownership.

## Scenario inventory

### `tests/sandbox/e2e/test_async_expose.py`

Evidence: [tests/sandbox/e2e/expose.test.ts](tests/sandbox/e2e/expose.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_expose_e2e` | covered |

### `tests/sandbox/e2e/test_async_files.py`

Evidence: [tests/sandbox/e2e/files.test.ts](tests/sandbox/e2e/files.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_files_e2e` | covered |

### `tests/sandbox/e2e/test_async_lifecycle.py`

Evidence: [tests/sandbox/e2e/lifecycle.test.ts](tests/sandbox/e2e/lifecycle.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_lifecycle_e2e` | covered |

### `tests/sandbox/e2e/test_async_list.py`

Evidence: [tests/sandbox/e2e/list.test.ts](tests/sandbox/e2e/list.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_list_e2e` | covered |

### `tests/sandbox/e2e/test_async_process.py`

Evidence: [tests/sandbox/e2e/process.test.ts](tests/sandbox/e2e/process.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_process_e2e` | covered |

### `tests/sandbox/e2e/test_async_sudo.py`

Evidence: [tests/sandbox/e2e/sudo.test.ts](tests/sandbox/e2e/sudo.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_sudo_e2e` | covered |

### `tests/sandbox/e2e/test_async_terminal_smoke.py`

Evidence: [tests/sandbox/e2e/terminal-smoke.test.ts](tests/sandbox/e2e/terminal-smoke.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_async_sandbox_terminal_e2e` | covered |

### `tests/sandbox/e2e/test_expose.py`

Evidence: [tests/sandbox/e2e/expose.test.ts](tests/sandbox/e2e/expose.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_expose_e2e` | covered |

### `tests/sandbox/e2e/test_files.py`

Evidence: [tests/sandbox/e2e/files.test.ts](tests/sandbox/e2e/files.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_files_e2e` | covered |

### `tests/sandbox/e2e/test_lifecycle.py`

Evidence: [tests/sandbox/e2e/lifecycle.test.ts](tests/sandbox/e2e/lifecycle.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_lifecycle_e2e` | covered |

### `tests/sandbox/e2e/test_list.py`

Evidence: [tests/sandbox/e2e/list.test.ts](tests/sandbox/e2e/list.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_list_e2e` | covered |

### `tests/sandbox/e2e/test_process.py`

Evidence: [tests/sandbox/e2e/process.test.ts](tests/sandbox/e2e/process.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_process_e2e` | covered |

### `tests/sandbox/e2e/test_resource_config.py`

Evidence: [tests/sandbox/e2e/resource-config.test.ts](tests/sandbox/e2e/resource-config.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_resource_config_e2e` | covered |
| `test_async_sandbox_resource_config_e2e` | covered |

### `tests/sandbox/e2e/test_runtime_transport.py`

Evidence: [tests/sandbox/e2e/runtime-transport.test.ts](tests/sandbox/e2e/runtime-transport.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_runtime_transport_target_ignores_ambient_proxy_without_explicit_override` | covered |
| `test_runtime_transport_target_prepends_sandbox_for_session_host_relative_paths` | covered |
| `test_runtime_transport_target_applies_explicit_proxy_override` | covered |
| `test_runtime_transport_target_preserves_region_path_base_prefix` | covered |
| `test_runtime_transport_target_avoids_double_sandbox_for_region_path_base` | covered |
| `test_runtime_websocket_target_applies_explicit_proxy_override` | covered |
| `test_runtime_websocket_target_preserves_region_path_base_prefix` | covered |

### `tests/sandbox/e2e/test_sudo.py`

Evidence: [tests/sandbox/e2e/sudo.test.ts](tests/sandbox/e2e/sudo.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_sudo_e2e` | covered |

### `tests/sandbox/e2e/test_terminal_smoke.py`

Evidence: [tests/sandbox/e2e/terminal-smoke.test.ts](tests/sandbox/e2e/terminal-smoke.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_terminal_e2e` | covered |

### `tests/test_build_context_fingerprint.py`

Evidence: [tests/unit/build-context-fingerprint.test.ts](tests/unit/build-context-fingerprint.test.ts), [tests/unit/python-context-reference.test.ts](tests/unit/python-context-reference.test.ts), [tests/unit/image-build-conformance.test.ts](tests/unit/image-build-conformance.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_fingerprint_format_is_stable_across_python_versions` | covered |
| `test_fingerprint_matches_bytes_in_actual_archives` | covered |
| `test_identity_tracks_effective_build_inputs` | covered |
| `test_dockerfile_specific_ignore_and_ignored_control_files` | covered |
| `test_identity_is_independent_of_absolute_path_and_compression` | covered |
| `test_fingerprint_never_compresses_stages_or_reads_whole_payload` | covered |
| `test_hard_links_preserve_all_paths_and_match_independent_copies` | covered |
| `test_mutation_rejected_using_archived_bytes_and_workspace_removed` | covered |
| `test_invalid_expected_fingerprints_are_rejected_before_packaging` | covered |
| `test_expected_fingerprint_cannot_be_silently_ignored_by_local_build` | covered |
| `test_public_build_checks_fingerprint_before_any_api_request` | covered |
| `test_image_readiness_is_independent_of_backup_and_backward_compatible` | covered |

### `tests/test_control_get_retries.py`

Evidence: [tests/unit/control-get-retries.test.ts](tests/unit/control-get-retries.test.ts), [tests/unit/runtime-http.test.ts](tests/unit/runtime-http.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sync_transport_get_retries_transient_status` | covered |
| `test_sync_transport_get_stops_after_three_attempts` | covered |
| `test_sync_transport_post_does_not_retry` | covered |
| `test_async_transport_get_retries_transient_network_error` | covered |
| `test_sync_sandbox_get_retries_transient_status` | covered |
| `test_async_sandbox_get_retries_transient_status` | covered |
| `test_async_sandbox_post_does_not_retry` | covered |

### `tests/test_create_sandbox_params.py`

Evidence: [tests/unit/python-wire-reference.test.ts](tests/unit/python-wire-reference.test.ts), [tests/unit/image-build-conformance.test.ts](tests/unit/image-build-conformance.test.ts), [tests/sandbox/e2e/sandbox-contract.test.ts](tests/sandbox/e2e/sandbox-contract.test.ts), [tests/sandbox/e2e/public-types-contract.test.ts](tests/sandbox/e2e/public-types-contract.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_create_sandbox_params_accepts_image_source` | covered |
| `test_create_sandbox_params_serializes_exposed_ports` | covered |
| `test_create_sandbox_params_serializes_mounts` | covered |
| `test_create_sandbox_params_serializes_network_policy` | covered |
| `test_sandbox_network_policy_serializes_update_payload` | covered |
| `test_sandbox_network_policy_defaults_unset_lists_for_response_models` | covered |
| `test_sandbox_network_policy_can_omit_unset_lists_for_patch_payload` | covered |
| `test_sandbox_image_build_params_serialize_expected_wire_keys` | covered |
| `test_remote_image_build_params_serialize_manifest_and_reuse_wire_keys` | covered |
| `test_sandbox_image_build_params_omit_unspecified_format_and_platform` | covered |
| `test_sandbox_image_build_params_reject_unsupported_source_platform` | covered |
| `test_sandbox_image_build_params_require_exact_literal_values` | covered |
| `test_image_build_list_params_reject_noncanonical_cancelled_spelling` | native equivalent: Node rejects invalid status literals in TypeScript; Python validates them at runtime with Pydantic. |
| `test_create_sandbox_params_accepts_snapshot_source` | covered |
| `test_start_sandbox_from_snapshot_params_are_snapshot_only` | covered |
| `test_start_sandbox_from_snapshot_params_reject_invalid_sources` | covered |
| `test_create_sandbox_params_rejects_camel_case_input` | native equivalent: Node intentionally accepts camelCase inputs; Python uses snake_case. |
| `test_create_sandbox_params_rejects_legacy_sandbox_name` | covered |
| `test_create_sandbox_params_rejects_multiple_sources` | covered |
| `test_create_sandbox_params_requires_snapshot_name_for_snapshot_id` | covered |
| `test_create_sandbox_params_rejects_resource_config_for_snapshot_source` | covered |
| `test_sandbox_exec_params_serialize_process_timeout_sec_as_snake_case` | covered |
| `test_sandbox_process_wait_params_serialize_timeout_sec_as_snake_case` | covered |
| `test_sandbox_process_list_params_serialize_created_filters_as_snake_case` | covered |
| `test_sandbox_snapshot_list_params_serialize_image_name_as_camel_case` | covered |
| `test_sandbox_snapshot_list_params_rejects_limit_above_api_max` | covered |
| `test_sandbox_file_write_entry_supports_batch_write_options` | covered |

### `tests/test_docker_context_parity.py`

Evidence: [tests/unit/docker-context-parity.test.ts](tests/unit/docker-context-parity.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_dockerfile_analysis_matches_go_or_falls_back_to_full` | covered |
| `test_dockerignore_context_selection_matches_go_fsutil` | covered |

### `tests/test_dockerfile_analysis.py`

Evidence: [tests/unit/python-reference.test.ts](tests/unit/python-reference.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_analyze_dockerfile_sources` | covered |
| `test_analyze_dockerfile_sources_falls_back_for_non_utf8` | covered |

### `tests/test_dockerignore.py`

Evidence: [tests/unit/python-reference.test.ts](tests/unit/python-reference.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_moby_pattern_matrix` | covered |
| `test_ordered_patterns_and_negations` | covered |
| `test_ignorefile_preprocessing_handles_bom_comments_cleaning_and_slashes` | covered |
| `test_comment_detection_happens_before_whitespace_trimming` | covered |
| `test_invalid_patterns_are_rejected_at_load_time` | covered |
| `test_context_root_cannot_be_ignored` | covered |

### `tests/test_image_resolution.py`

Evidence: [tests/unit/image-resolution.test.ts](tests/unit/image-resolution.test.ts), [tests/unit/image-build-conformance.test.ts](tests/unit/image-build-conformance.test.ts), [tests/unit/docker-lifecycle-conformance.test.ts](tests/unit/docker-lifecycle-conformance.test.ts), [tests/unit/python-reference.test.ts](tests/unit/python-reference.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_resolves_ready_new_and_concurrent_builds` | covered |
| `test_incompatible_conflicts_are_not_joined` | covered |
| `test_context_change_during_lookup_fails_before_submission` | covered |
| `test_ready_lookup_supports_old_servers_and_does_not_reuse_pending_rows` | covered |
| `test_exact_ready_lookup_searches_later_pages` | covered |
| `test_docker_identity_is_verified_before_import` | covered |
| `test_docker_identity_errors_fail_before_http` | covered |
| `test_remote_build_and_known_digest_cache_hit_need_no_docker` | covered |
| `test_identity_separates_content_and_initialization_but_normalizes_dict_order` | covered |
| `test_invalid_source_options_fail_without_http` | covered |
| `test_independent_async_waiters_never_cancel_accepted_backend_build` | covered |

### `tests/test_network_error_normalization.py`

Evidence: [tests/unit/control-get-retries.test.ts](tests/unit/control-get-retries.test.ts), [tests/unit/runtime-http.test.ts](tests/unit/runtime-http.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_control_flow_exceptions_propagate_instead_of_becoming_network_errors` | native equivalent: Node uses AbortSignal and structured request_aborted; Python task/process exception classes do not exist in Node. |
| `test_transport_error_without_a_message_reports_its_type` | native equivalent: Native exception type names differ; both preserve a useful type when the message is empty. |
| `test_transport_error_with_a_message_keeps_its_detail` | covered |
| `test_request_context_is_appended_so_the_failing_call_is_identifiable` | native equivalent: Node exposes method/path fields; Python appends context to the message. |
| `test_request_context_drops_query_strings_and_hosts` | native equivalent: Node exposes a sanitized structured path; diagnostic string formatting differs. |

### `tests/test_sandbox_image_build_helpers.py`

Evidence: [tests/unit/docker-image-manifest.test.ts](tests/unit/docker-image-manifest.test.ts), [tests/unit/docker-lifecycle-conformance.test.ts](tests/unit/docker-lifecycle-conformance.test.ts), [tests/unit/image-build-conformance.test.ts](tests/unit/image-build-conformance.test.ts), [tests/unit/python-context-reference.test.ts](tests/unit/python-context-reference.test.ts), [tests/unit/python-reference.test.ts](tests/unit/python-reference.test.ts), [tests/unit/docker-context-parity.test.ts](tests/unit/docker-context-parity.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_image_build_model_rejects_invalid_status_casing` | native equivalent: Node has TypeScript response unions; Python Pydantic response-model validation is not reproduced. |
| `test_build_docker_image_from_dockerfile_targets_linux_amd64` | covered |
| `test_package_docker_image_rejects_non_amd64_local_image` | covered |
| `test_ensure_docker_image_source_platform_compares_case_insensitively` | covered |
| `test_package_docker_container_reaps_export_process_on_read_failure` | covered |
| `test_upload_image_build_artifact_streams_file_with_content_length` | covered |
| `test_upload_image_build_artifact_retries_retryable_status` | covered |
| `test_remote_dockerfile_context_is_deterministic_and_sparse` | covered |
| `test_remote_dockerfile_context_includes_colon_named_add_sources` | covered |
| `test_remote_dockerfile_context_falls_back_for_variable_source` | covered |
| `test_remote_dockerfile_context_falls_back_for_source_glob` | covered |
| `test_remote_context_prunes_ignored_directories_without_negations` | covered |
| `test_remote_context_preserves_negated_descendant` | covered |
| `test_remote_context_honors_dockerfile_specific_ignore_rules` | covered |
| `test_remote_context_sparse_source_includes_symlink_target_closure` | covered |
| `test_remote_context_includes_ignored_symlink_dockerfile_target` | covered |
| `test_remote_context_preserves_external_and_broken_symlink_metadata` | covered |
| `test_existing_import_source_retains_container_fallback` | covered |
| `test_package_docker_image_manifest_preserves_reusable_layers` | covered |
| `test_sync_dockerfile_build_uses_remote_context_by_default` | covered |
| `test_docker_image_exact_reuse_preserves_env_without_docker_save` | covered |
| `test_image_build_helpers_forward_builder_resources` | covered |
| `test_sync_dockerfile_image_build_cleans_temp_tag_on_build_failure` | covered |
| `test_sync_wait_for_image_build_returns_completed_status` | covered |
| `test_sync_wait_for_image_build_raises_detailed_failed_status` | covered |
| `test_sync_complete_image_build_retries_upload_verification_race` | covered |
| `test_async_dockerfile_image_build_cleans_temp_tag_on_build_failure` | covered |
| `test_async_wait_for_image_build_returns_completed_status` | covered |
| `test_async_wait_for_image_build_raises_detailed_failed_status` | covered |

### `tests/test_sandbox_process_collection.py`

Evidence: [tests/unit/process-collection.test.ts](tests/unit/process-collection.test.ts), [tests/unit/python-reference.test.ts](tests/unit/python-reference.test.ts), [tests/unit/runtime-http.test.ts](tests/unit/runtime-http.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sync_collects_large_output_and_streams_from_same_request` | covered |
| `test_async_collects_large_output_and_streams_from_same_request` | covered |
| `test_sync_incomplete_output_is_not_success_or_reexecuted` | covered |
| `test_async_incomplete_output_is_not_success_or_reexecuted` | covered |
| `test_async_wait_timeout_keeps_collector_alive` | covered |
| `test_async_disconnect_closes_stream_without_killing_command` | covered |
| `test_sync_wait_timeout_and_disconnect_unblock_collector` | covered |
| `test_async_exec_cancellation_closes_stream` | covered |
| `test_invalid_collection_limit_rejected_before_start` | covered |

### `tests/test_sandbox_runtime_transport.py`

Evidence: [tests/unit/runtime-http.test.ts](tests/unit/runtime-http.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sync_streaming_start_does_not_fallback_or_reexecute_on_old_receiver` | covered |
| `test_async_streaming_start_does_not_fallback_or_reexecute_on_old_receiver` | covered |
| `test_sync_runtime_transport_does_not_retry_consumed_stream_body` | covered |
| `test_async_runtime_transport_does_not_retry_consumed_stream_body` | covered |

### `tests/test_sandbox_stream_timeouts.py`

Evidence: [tests/unit/runtime-http.test.ts](tests/unit/runtime-http.test.ts), [tests/unit/python-sse-reference.test.ts](tests/unit/python-sse-reference.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_process_stream_accepts_line_terminators` | covered |
| `test_quiet_process_and_heartbeats_outlive_request_timeout` | covered |
| `test_missing_heartbeats_fail_without_reexecuting` | covered |
| `test_response_headers_keep_ordinary_request_timeout` | covered |
| `test_json_body_keeps_ordinary_request_timeout` | covered |

### `tests/test_sandbox_wire_contract.py`

Evidence: [tests/unit/python-wire-reference.test.ts](tests/unit/python-wire-reference.test.ts), [tests/sandbox/e2e/sandbox-contract.test.ts](tests/sandbox/e2e/sandbox-contract.test.ts), [tests/unit/sandbox-parity.test.ts](tests/unit/sandbox-parity.test.ts), [tests/unit/file-watch.test.ts](tests/unit/file-watch.test.ts), [tests/unit/process-collection.test.ts](tests/unit/process-collection.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sandbox_request_models_serialize_expected_wire_keys` | covered |
| `test_sandbox_process_models_accept_current_camel_case_wire_keys` | covered |
| `test_sync_sandbox_image_build_manager_uses_expected_wire_keys` | covered |
| `test_sync_sandbox_image_build_reuse_uses_expected_wire_keys` | covered |
| `test_sync_start_from_snapshot_uses_snapshot_only_payload` | covered |
| `test_sync_sandbox_snapshot_and_image_build_list_contract` | covered |
| `test_sync_image_build_omits_unspecified_fields_for_dicts_and_legacy_models` | native equivalent: The mapping wire behavior is exercised; Node does not accept Python legacy Pydantic instances. |
| `test_image_builder_resources_wire_contract` | covered |
| `test_sync_sandbox_control_manager_uses_expected_wire_keys` | covered |
| `test_sync_sandbox_update_network_omits_only_unset_lists` | covered |
| `test_snapshot_summary_allows_missing_compatibility_tag` | covered |
| `test_sandbox_models_accept_close_error_status` | covered |
| `test_sandbox_response_and_handles_expose_timeout_minutes` | covered |
| `test_sync_close_error_sandbox_is_unavailable_at_runtime` | covered |
| `test_async_close_error_sandbox_is_unavailable_at_runtime` | covered |
| `test_image_build_list_params_leave_numeric_validation_to_server` | covered |
| `test_build_sandbox_exposed_url_uses_runtime_base_path_session_id` | covered |
| `test_build_sandbox_exposed_url_uses_session_id_from_runtime_host_path` | covered |
| `test_sync_sandbox_runtime_apis_use_expected_wire_keys` | covered |
| `test_sync_sandbox_process_string_calls_support_run_as` | covered |
| `test_sync_sandbox_handle_exec_string_call_supports_run_as` | covered |
| `test_async_sandbox_image_build_manager_uses_expected_wire_keys` | covered |
| `test_async_sandbox_image_build_reuse_uses_expected_wire_keys` | covered |
| `test_async_start_from_snapshot_uses_snapshot_only_payload` | covered |
| `test_async_sandbox_snapshot_and_image_build_list_contract` | covered |
| `test_async_sandbox_control_manager_uses_expected_wire_keys` | covered |
| `test_async_sandbox_update_network_omits_only_unset_lists` | covered |
| `test_async_sandbox_runtime_apis_use_expected_wire_keys` | covered |
| `test_async_sandbox_process_string_calls_support_run_as` | covered |
| `test_sync_terminal_attach_includes_cursor` | covered |
| `test_async_terminal_attach_includes_cursor` | covered |

### `tests/test_typed_dict_runtime_parity.py`

Evidence: [tests/unit/python-wire-reference.test.ts](tests/unit/python-wire-reference.test.ts), [tests/sandbox/e2e/process-api.test.ts](tests/sandbox/e2e/process-api.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_sync_sandbox_lifecycle_dicts_match_legacy_models_on_the_wire` | native equivalent: The mapping wire behavior is exercised; Node does not accept Python legacy Pydantic instances. |
| `test_async_sandbox_lifecycle_dicts_match_legacy_models_on_the_wire` | native equivalent: The mapping wire behavior is exercised; Node does not accept Python legacy Pydantic instances. |
| `test_sync_sandbox_runtime_dicts_match_legacy_models_on_the_wire` | native equivalent: The mapping wire behavior is exercised; Node does not accept Python legacy Pydantic instances. |
| `test_async_sandbox_runtime_dicts_match_legacy_models_on_the_wire` | native equivalent: The mapping wire behavior is exercised; Node does not accept Python legacy Pydantic instances. |
| `test_sync_computer_action_dicts_match_legacy_models_on_the_wire` | out of scope: Browser/computer-action parity was explicitly deferred. |
| `test_async_computer_action_dicts_match_legacy_models_on_the_wire` | out of scope: Browser/computer-action parity was explicitly deferred. |

### `tests/test_typed_request_surface.py`

Evidence: [tests/sandbox/e2e/public-types-contract.test.ts](tests/sandbox/e2e/public-types-contract.test.ts), [src/types/sandbox.contract.d.ts](src/types/sandbox.contract.d.ts), [scripts/check-package.cjs](scripts/check-package.cjs).

| Python test function | Classification |
| --- | --- |
| `test_typed_request_models_track_legacy_request_fields_and_required_keys` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_sandbox_create_types_express_the_valid_launch_source_shapes` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_request_annotations_do_not_leak_pydantic_models` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_every_public_request_model_input_has_and_accepts_a_typed_dict` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_responses_remain_pydantic_and_legacy_requests_remain_importable` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |

### `tests/test_typing_contract.py`

Evidence: [tests/sandbox/e2e/public-types-contract.test.ts](tests/sandbox/e2e/public-types-contract.test.ts), [src/types/sandbox.contract.d.ts](src/types/sandbox.contract.d.ts), [scripts/check-package.cjs](scripts/check-package.cjs).

| Python test function | Classification |
| --- | --- |
| `test_valid_typed_dict_and_legacy_request_calls_typecheck` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_valid_typed_dict_and_legacy_request_calls_typecheck_with_pyright` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_invalid_inline_request_keys_and_values_are_rejected` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |
| `test_invalid_requests_are_rejected_on_the_same_lines_by_pyright` | native equivalent: Sandbox portions map to TypeScript unions and fresh installed consumer checks; mypy/pyright/Pydantic and non-sandbox models are language-specific or out of scope. |

### `tests/test_volume_wire_contract.py`

Evidence: [tests/unit/python-wire-reference.test.ts](tests/unit/python-wire-reference.test.ts), [tests/sandbox/e2e/volumes-contract.test.ts](tests/sandbox/e2e/volumes-contract.test.ts), [tests/unit/sandbox-parity.test.ts](tests/unit/sandbox-parity.test.ts).

| Python test function | Classification |
| --- | --- |
| `test_volume_models_serialize_and_parse_expected_wire_keys` | covered |
| `test_volume_list_params_leave_numeric_validation_to_server` | covered |
| `test_sync_volume_manager_uses_expected_wire_keys` | covered |
| `test_async_volume_manager_uses_expected_wire_keys` | covered |
| `test_sync_volume_list_without_params_remains_supported` | covered |
| `test_async_volume_list_without_params_remains_supported` | covered |
