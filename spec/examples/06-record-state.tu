# ===========================================================================
# 06 — Typed record state
# ===========================================================================

state {
  analytics {
    counters:rec<str, number> = {}
    labels:rec<number, str>   = {}
    readings:arr<rec<str, number>> = []
    buckets:rec<str, arr<number>> = {}
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
      counters:rec<str, number> <~ @analytics.counters
      labels:rec<number, str>   <~ @analytics.labels
      readings:arr<rec<str, number>> <~ @analytics.readings
      buckets:rec<str, arr<number>> <~ @analytics.buckets
      scores:arr<number> = record_get(buckets, "scores")

      updated:rec<str, number> = (record_set(counters, "visits", 1)) ~> @analytics.counters
      visits:number                = record_get(updated, "visits")
      ready:bool := visits >= 0
    }
  }
}
