# ===========================================================================
# 03 — Warehouse pick-pack-ship, across three scenes
# ===========================================================================

state {
  order {
    line_count:number   = 0
    priority:bool       = false
    address_valid:bool  = false
  }
  pick {
    picked_count:number = 0
    short_picked:bool   = false
    tote_id:str         = ""
  }
  pack {
    carton:str        = ""
    weight_kg:number  = 0
    sealed:bool       = false
  }
  ship {
    carrier:str = ""
    label:str   = ""
    status:str  = ""
  }
}

# ---------------------------------------------------------------------------
# Scene 1: picking
# ---------------------------------------------------------------------------

scene "picking" {
  entry_action = start_pick

  overview at_least {
    start_pick |-> pick_complete
    start_pick |-> pick_short
  }

  action "start_pick" {
    """
    Walk the pick list and count what actually came off the shelf.
    """
    compute "start_pick_graph" {
      line_count:number   <~ @order.line_count
      picked_count:number <~ @pick.picked_count

      complete:bool = picked_count >= line_count

      ("TOTE-A")                      ~> @pick.tote_id
      short:bool := (complete.not())  ~> @pick.short_picked
    }

    next short -> pick_short
    next pick_complete
  }

  action "pick_complete" {
    """
    Terminal for this scene: everything on the list is in the tote. The route
    sends this path onward to packing.
    """
    compute "pick_complete_graph" {
      tote_id:str           <~ @pick.tote_id
      ("picked " + tote_id) ~> @ship.status
    }
  }

  action "pick_short" {
    """
    Terminal for this scene: the tote is short. The route diverts this path.
    """
    compute "pick_short_graph" {
      picked_count:number                         <~ @pick.picked_count
      ("short by count " + picked_count.toStr())  ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 2: packing
# ---------------------------------------------------------------------------

scene "packing" {
  entry_action = choose_carton

  overview nodes_only {
    choose_carton |-> seal_carton
    seal_carton
  }

  action "choose_carton" {
    """
    Pick a carton size from the line count.
    """
    compute "choose_carton_graph" {
      line_count:number <~ @order.line_count
      large:bool = line_count >= 10
      carton:str = if(large, "L", "S")

      (carton)          ~> @pack.carton
      (line_count * 2)  ~> @pack.weight_kg
    }

    next seal_carton
  }

  action "seal_carton" {
    """
    Terminal for this scene: tape it shut.
    """
    compute "seal_carton_graph" {
      carton:str  <~ @pack.carton
      (true)      ~> @pack.sealed
      ("packed in " + carton) ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 3: shipping
# ---------------------------------------------------------------------------

scene "shipping" {
  entry_action = select_carrier

  action "select_carrier" {
    """
    Choose a carrier from priority and parcel weight.
    """
    compute "select_carrier_graph" {
      priority:bool     <~ @order.priority
      weight_kg:number  <~ @pack.weight_kg

      heavy:bool = weight_kg >= 20

      carrier:str = case(
        (priority, heavy),
        (true, _)  -> "air",
        (_, true)  -> "freight",
        _ -> "ground"
      )

      (carrier) ~> @ship.carrier
      (true)    ~> @pack.sealed
    }

    next on (carrier) to {
      "air" -> print_express_label,
      _     -> print_standard_label
    }
  }

  action "print_express_label" {
    """
    Terminal: express label, ready for the priority sort.
    """
    compute "express_label_graph" {
      carrier:str                       <~ @ship.carrier
      ("EXP-" + carrier.toUpperCase())  ~> @ship.label
      ("labelled express")              ~> @ship.status
    }
  }

  action "print_standard_label" {
    """
    Terminal: standard label.
    """
    compute "standard_label_graph" {
      carrier:str                       <~ @ship.carrier
      ("STD-" + carrier.toUpperCase())  ~> @ship.label
      ("labelled standard")             ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# Scene 4: handoff
# ---------------------------------------------------------------------------

scene "handoff" {
  entry_action = release_to_carrier

  action "release_to_carrier" {
    """
    Terminal for the whole route: the parcel leaves the building.
    """
    compute "release_graph" {
      label:str             <~ @ship.label
      ("released " + label) ~> @ship.status
    }
  }
}

# ---------------------------------------------------------------------------
# The route
# ---------------------------------------------------------------------------

route "fulfilment" {
  entry = picking

  to {
    picking.pick_short                  -> shipping,
    picking.*.pick_complete             -> packing,
    packing.*.choose_carton.seal_carton -> shipping,
    shipping.*.print_express_label |
    shipping.*.print_standard_label
                                        -> handoff
  }
}
