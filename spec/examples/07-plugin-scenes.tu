# ===========================================================================
# 07 — Scenes that arrive while the flow runs
# ===========================================================================
#
# The checkout and returns lanes are not in this file. They are compiled
# separately and pulled in by an `extend` hook at the moment the flow needs to
# know which lane it is on. The route arms below name them anyway: a model that
# can grow is not held to already containing every scene an arm targets.

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
    """
    Load whichever lane definitions this deployment has, then decide which of
    them the cart belongs in. The hooks fire before any binding below is
    resolved, so a STATE field a loaded model introduces is readable here.
    """

    extend {
      model = "fetch_checkout_scenes"
      model = "fetch_returns_scenes"
    }

    compute "lane_graph" {
      item_count:number <~ @cart.item_count
      is_return:bool    <~ @cart.is_return

      has_items:bool = item_count > 0

      lane:str := (case(
        (is_return, has_items),
        (true, _) -> "returns",
        (_, true) -> "checkout",
        _         -> "empty"
      )) ~> @cart.lane
    }
  }
}

scene "empty_cart" {
  entry_action = say_empty

  action "say_empty" {
    """
    Terminal: nothing to check out and nothing to send back.
    """
    compute "empty_graph" {
      ("") ~> @cart.lane
    }
  }
}

# "checkout" and "returns" are declared by the models the hooks return. Naming
# them here is what makes them reachable the moment they arrive; a target that
# never arrives is a runtime error when the transition is taken, not a compile
# error now.
route "shopping" {
  entry = triage
  to {
    triage.pick_lane -> checkout,
    empty_cart.say_empty -> .,
    _ -> empty_cart
  }
}
