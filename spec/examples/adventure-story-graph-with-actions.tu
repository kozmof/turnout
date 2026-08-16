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
    - Take the first eligible route: forest, gate, sewer, then campfire fallback.
    """

    compute "choose_route_graph" {
      has_map:bool <~ @story.has_map
      clue_count:number <~ @story.clue_count
      coins:number <~ @party.coins
      lockpick_skill:number <~ @party.lockpick_skill

      ("route_selected") ~> @story.chapter_state
      ("crossroads") ~> @story.last_hub

      can_forest:bool = has_map & clue_count >= 2
      can_gate:bool = coins >= 3
      can_sewer:bool = lockpick_skill >= 1

      route_available:bool := can_forest | can_gate | can_sewer
    }

    next can_forest -> forest_trail
    next can_gate -> city_gate
    next can_sewer -> sewer_tunnel
    next campfire_wait
  }

  action "forest_trail" {
    """
    Logic overview:
    - Set forest route metadata and a deterministic danger level.
    - Emit route, current location, and threat level to story state.
    - Always continue to `shrine_discovery`.
    """

    compute "forest_trail_graph" {
      ("Whispering Forest") ~> @story.current_location
      (2) ~> @story.threat_level

      story_route:str := ("forest_trail") ~> @story.path
    }

    next shrine_discovery
  }

  action "city_gate" {
    """
    Logic overview:
    - Read current coins from STATE and apply the city gate toll.
    - Emit updated coin balance plus route/location updates.
    - Always continue to `courtyard_arrival`.
    """

    compute "city_gate_graph" {
      coins:number <~ @party.coins
      toll:number = 3

      ("Stonebridge Gate") ~> @story.current_location
      (coins - toll) ~> @party.coins

      story_route:str := ("city_gate") ~> @story.path
    }

    next courtyard_arrival
  }

  action "sewer_tunnel" {
    """
    Logic overview:
    - Read lockpick skill from STATE and evaluate hidden-mark discovery.
    - Emit route/location updates and discovery flag.
    - Always continue to `hidden_archive`.
    """

    compute "sewer_tunnel_graph" {
      lockpick_skill:number <~ @party.lockpick_skill

      ("Sunken Tunnel") ~> @story.current_location
      (lockpick_skill >= 2) ~> @story.found_hidden_mark

      story_route:str := ("sewer_tunnel") ~> @story.path
    }

    next hidden_archive
  }

  action "campfire_wait" {
    """
    Logic overview:
    - Set route and journal note for the wait-at-camp branch.
    - Emit route/journal fields and a fixed camp location value.
    - Always continue to `chapter_end`.
    """

    compute "campfire_wait_graph" {
      ("waited_until_dawn") ~> @story.latest_journal
      ("Crossroads Camp") ~> @story.current_location

      story_route:str := ("campfire_wait") ~> @story.path
    }

    next chapter_end
  }

  action "shrine_discovery" {
    """
    Logic overview:
    - Materialize shrine reward text from relic data.
    - Emit chapter reward and fixed shrine location.
    - Always continue to `chapter_end`.
    """

    compute "shrine_discovery_graph" {
      ("Ruined Shrine") ~> @story.current_location

      reward:str := ("Moon Sigil") ~> @story.chapter_reward
    }

    next chapter_end
  }

  action "courtyard_arrival" {
    """
    Logic overview:
    - Materialize city-branch reward text from writ data.
    - Emit chapter reward and fixed courtyard location.
    - Always continue to `chapter_end`.
    """

    compute "courtyard_arrival_graph" {
      ("Castle Courtyard") ~> @story.current_location

      reward:str := ("Guest Writ") ~> @story.chapter_reward
    }

    next chapter_end
  }

  action "hidden_archive" {
    """
    Logic overview:
    - Materialize archive-branch reward text from ledger data.
    - Emit chapter reward and fixed archive location.
    - Always continue to `chapter_end`.
    """

    compute "hidden_archive_graph" {
      ("Hidden Archive") ~> @story.current_location

      reward:str := ("Old Kingdom Ledger") ~> @story.chapter_reward
    }

    next chapter_end
  }

  action "chapter_end" {
    """
    Logic overview:
    - Build final chapter result identifier from prefix/suffix.
    - Mark chapter state as resolved and store the final result string.
    """

    compute "chapter_end_graph" {
      prefix:str = "chapter_1_"
      suffix:str = "complete"

      ("resolved") ~> @story.chapter_state

      chapter_result:str := (prefix + suffix) ~> @story.result
    }

  }
}
