state {
  story {
    has_map:bool = false
    clue_count:number = 0
    chapter_state:str = ""
    last_hub:str = ""
    path:str = ""
    current_location:str = ""
    threat_level:number = 0
    found_hidden_mark:bool = false
    latest_journal:str = ""
    chapter_reward:str = ""
    result:str = ""
  }
  party {
    coins:number = 0
    lockpick_skill:number = 0
  }
}

scene "adventure_story_chapter_1" {
  entry_actions     = [choose_route]
  next_policy       = "first-match"

  overview at_least {
    choose_route |=> forest_trail
    choose_route |=> city_gate
    choose_route |=> sewer_tunnel
    choose_route |=> campfire_wait
    forest_trail |=> shrine_discovery
    city_gate |=> courtyard_arrival
    sewer_tunnel |=> hidden_archive
    campfire_wait |=> chapter_end
    shrine_discovery |=> chapter_end
    courtyard_arrival |=> chapter_end
    hidden_archive |=> chapter_end
  }

  action "choose_route" {
    """
    Logic overview:
    - Collect map/clue/coin/lockpick values from STATE inputs.
    - Compute route eligibility flags (`can_forest`, `can_gate`, `can_sewer`).
    - Persist chapter hub metadata after route selection.
    - Evaluate next actions in order: forest, gate, sewer, then campfire fallback.
    """

    compute {
      prog "choose_route_graph" {
        has_map:bool <~ @story.has_map
        clue_count:number <~ @story.clue_count
        coins:number <~ @party.coins
        lockpick_skill:number <~ @party.lockpick_skill
        chapter_state:str = ("route_selected") ~> @story.chapter_state
        last_hub:str = ("crossroads") ~> @story.last_hub

        clue_enough:bool = clue_count >= 2
        can_forest:bool = has_map & clue_enough
        can_gate:bool = coins >= 3
        can_sewer:bool = lockpick_skill >= 1
        |^| decision_ready:bool = true
      }
    }

    next {
      compute {
        prog "to_forest" {
          can_forest:bool <~ action(can_forest)
          |?| go_forest:bool = can_forest
        }
      }
      action = forest_trail
    }

    next {
      compute {
        prog "to_gate" {
          can_gate:bool <~ action(can_gate)
          |?| go_gate:bool = can_gate
        }
      }
      action = city_gate
    }

    next {
      compute {
        prog "to_sewer" {
          can_sewer:bool <~ action(can_sewer)
          |?| go_sewer:bool = can_sewer
        }
      }
      action = sewer_tunnel
    }

    next {
      action = campfire_wait
    }
  }

  action "forest_trail" {
    """
    Logic overview:
    - Set forest route metadata and a deterministic danger level.
    - Emit route, current location, and threat level to story state.
    - Always continue to `shrine_discovery`.
    """

    compute {
      prog "forest_trail_graph" {
        route_name:str = "forest_trail"
        danger:number = 2

        location:str = ("Whispering Forest") ~> @story.current_location
        danger_level:number = (danger) ~> @story.threat_level
        |^| story_route:str = (route_name) ~> @story.path
      }
    }

    next {
      action = shrine_discovery
    }
  }

  action "city_gate" {
    """
    Logic overview:
    - Read current coins from STATE and apply the city gate toll.
    - Emit updated coin balance plus route/location updates.
    - Always continue to `courtyard_arrival`.
    """

    compute {
      prog "city_gate_graph" {
        route_name:str = "city_gate"
        location:str = ("Stonebridge Gate") ~> @story.current_location
        coins:number <~ @party.coins
        toll:number    = 3

        coins_after:number = (coins - toll) ~> @party.coins
        |^| story_route:str = (route_name) ~> @story.path
      }
    }

    next {
      action = courtyard_arrival
    }
  }

  action "sewer_tunnel" {
    """
    Logic overview:
    - Read lockpick skill from STATE and evaluate hidden-mark discovery.
    - Emit route/location updates and discovery flag.
    - Always continue to `hidden_archive`.
    """

    compute {
      prog "sewer_tunnel_graph" {
        route_name:str = "sewer_tunnel"
        location:str = ("Sunken Tunnel") ~> @story.current_location
        lockpick_skill:number <~ @party.lockpick_skill

        found_mark:bool = (lockpick_skill >= 2) ~> @story.found_hidden_mark
        |^| story_route:str = (route_name) ~> @story.path
      }
    }

    next {
      action = hidden_archive
    }
  }

  action "campfire_wait" {
    """
    Logic overview:
    - Set route and journal note for the wait-at-camp branch.
    - Emit route/journal fields and a fixed camp location value.
    - Always continue to `chapter_end`.
    """

    compute {
      prog "campfire_wait_graph" {
        route_name:str = "campfire_wait"
        note:str = ("waited_until_dawn") ~> @story.latest_journal
        location:str = ("Crossroads Camp") ~> @story.current_location
        |^| story_route:str = (route_name) ~> @story.path
      }
    }

    next {
      action = chapter_end
    }
  }

  action "shrine_discovery" {
    """
    Logic overview:
    - Materialize shrine reward text from relic data.
    - Emit chapter reward and fixed shrine location.
    - Always continue to `chapter_end`.
    """

    compute {
      prog "shrine_discovery_graph" {
        relic:str = "Moon Sigil"
        location:str = ("Ruined Shrine") ~> @story.current_location
        |^| reward:str = (relic) ~> @story.chapter_reward
      }
    }

    next {
      action = chapter_end
    }
  }

  action "courtyard_arrival" {
    """
    Logic overview:
    - Materialize city-branch reward text from writ data.
    - Emit chapter reward and fixed courtyard location.
    - Always continue to `chapter_end`.
    """

    compute {
      prog "courtyard_arrival_graph" {
        writ:str = "Guest Writ"
        location:str = ("Castle Courtyard") ~> @story.current_location
        |^| reward:str = (writ) ~> @story.chapter_reward
      }
    }

    next {
      action = chapter_end
    }
  }

  action "hidden_archive" {
    """
    Logic overview:
    - Materialize archive-branch reward text from ledger data.
    - Emit chapter reward and fixed archive location.
    - Always continue to `chapter_end`.
    """

    compute {
      prog "hidden_archive_graph" {
        ledger:str = "Old Kingdom Ledger"
        location:str = ("Hidden Archive") ~> @story.current_location
        |^| reward:str = (ledger) ~> @story.chapter_reward
      }
    }

    next {
      action = chapter_end
    }
  }

  action "chapter_end" {
    """
    Logic overview:
    - Build final chapter result identifier from prefix/suffix.
    - Mark chapter state as resolved and store the final result string.
    """

    compute {
      prog "chapter_end_graph" {
        prefix:str = "chapter_1_"
        suffix:str = "complete"
        chapter_state:str = ("resolved") ~> @story.chapter_state
        |^| chapter_result:str = (prefix + suffix) ~> @story.result
      }
    }

  }
}
