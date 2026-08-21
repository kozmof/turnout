# ===========================================================================
# 06 — Typed record state
# ===========================================================================

state {
  analytics {
    counters:Record<str, number> = {}
    labels:Record<number, str>   = {}
  }
}

scene "record_state" {
  entry_action = inspect_records

  action "inspect_records" {
    """
    Read a typed record from STATE, update one key immutably, write the updated
    record back to STATE, and retrieve the new value with record_get().
    """

    compute "record_graph" {
      counters:Record<str, number> <~ @analytics.counters
      labels:Record<number, str>   <~ @analytics.labels

      updated:Record<str, number> = (record_set(counters, "visits", 1)) ~> @analytics.counters
      visits:number                = record_get(updated, "visits")
      ready:bool := visits >= 0
    }
  }
}
