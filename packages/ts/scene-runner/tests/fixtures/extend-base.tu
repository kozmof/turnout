# ===========================================================================
# Conformance: a model that grows while it runs
# ===========================================================================
#
# The lane is not in this file. It is compiled separately, in
# extend-lane.tu, and pulled in by an `extend` hook at the moment the flow
# needs it. The route arm below names it anyway: a model that can grow is not
# held to already containing every scene an arm targets.
#
# There is no catchall arm, so the route ends when the lane scene terminates.

state {
  cart {
    item_count:number = 0
    is_return:bool    = false
    lane:str          = ""
  }
}

scene "triage" {
  entry_action = pick_lane

  action "pick_lane" {
    extend {
      model = "load_lane"
    }

    compute "lane_graph" {
      item_count:number <~ @cart.item_count

      has_items:bool = item_count > 0

      lane:str := (if(has_items, "checkout", "empty")) ~> @cart.lane
    }
  }
}

route "shopping" {
  entry = triage
  to {
    triage.pick_lane -> checkout
  }
}
