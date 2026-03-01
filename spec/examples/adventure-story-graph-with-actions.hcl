scene "adventure_story_chapter_1" {
  entry_actions     = ["choose_route"]
  next_policy       = "first-match"

  view "overview" {
    text = <<-EOT
      choose_route
        |=> forest_trail
        |=> city_gate
        |=> sewer_tunnel
        |=> campfire_wait
      forest_trail
        |=> shrine_discovery
      city_gate
        |=> courtyard_arrival
      sewer_tunnel
        |=> hidden_archive
      campfire_wait
        |=> chapter_end
      shrine_discovery
        |=> chapter_end
      courtyard_arrival
        |=> chapter_end
      hidden_archive
        |=> chapter_end
    EOT
    enforce = "at_least"
  }

  action "choose_route" {
    compute {
      root     = decision_ready
      prog "choose_route_graph" {
        has_map:bool = false
        clue_count:int = 0
        coins:int = 0
        lockpick_skill:int = 0

        clue_enough:bool =| clue_count >= 2
        can_forest:bool = bool_and(has_map, clue_enough)
        can_gate:bool =| coins >= 3
        can_sewer:bool =| lockpick_skill >= 1
        decision_ready:bool = bool_and(true, true)
      }
    }

    ingress {
      to        = has_map
      from_ssot = story.flags.has_map
    }

    ingress {
      to        = clue_count
      from_ssot = story.clues.count
    }

    ingress {
      to        = coins
      from_ssot = party.inventory.coins
    }

    ingress {
      to        = lockpick_skill
      from_ssot = party.skills.lockpick
    }

    egress {
      to           = story.chapter_state
      from_literal = "route_selected"
    }

    egress {
      to           = story.last_hub
      from_literal = "crossroads"
    }

    next {
      compute {
        condition = go_forest
        prog "to_forest" {
          can_forest:bool = false
          go_forest:bool = bool_and(can_forest, true)
        }
      }
      ingress {
        to          = can_forest
        from_action = can_forest
      }
      action = forest_trail
    }

    next {
      compute {
        condition = go_gate
        prog "to_gate" {
          can_gate:bool = false
          go_gate:bool = bool_and(can_gate, true)
        }
      }
      ingress {
        to          = can_gate
        from_action = can_gate
      }
      action = city_gate
    }

    next {
      compute {
        condition = go_sewer
        prog "to_sewer" {
          can_sewer:bool = false
          go_sewer:bool = bool_and(can_sewer, true)
        }
      }
      ingress {
        to          = can_sewer
        from_action = can_sewer
      }
      action = sewer_tunnel
    }

    next {
      compute {
        condition = always
        prog "to_campfire" {
          always:bool = true
        }
      }
      action = campfire_wait
    }
  }

  action "forest_trail" {
    compute {
      root     = story_route
      prog "forest_trail_graph" {
        route:str = "forest_trail"
        location:str = "Whispering Forest"
        danger:int = 2

        story_route:str =| route + ""
        danger_level:int =| danger + 0
      }
    }

    egress {
      to   = story.route
      from = story_route
    }

    egress {
      to   = story.current_location
      from = location
    }

    egress {
      to   = story.threat_level
      from = danger_level
    }

    next {
      compute {
        condition = always
        prog "to_shrine_discovery" {
          always:bool = true
        }
      }
      action = shrine_discovery
    }
  }

  action "city_gate" {
    compute {
      root     = story_route
      prog "city_gate_graph" {
        route:str = "city_gate"
        location:str = "Stonebridge Gate"
        coins:int = 0
        toll:int = 3

        coins_after:int =| coins - toll
        story_route:str =| route + ""
      }
    }

    ingress {
      to        = coins
      from_ssot = party.inventory.coins
    }

    egress {
      to   = party.inventory.coins
      from = coins_after
    }

    egress {
      to   = story.current_location
      from = location
    }

    egress {
      to   = story.route
      from = story_route
    }

    next {
      compute {
        condition = always
        prog "to_courtyard_arrival" {
          always:bool = true
        }
      }
      action = courtyard_arrival
    }
  }

  action "sewer_tunnel" {
    compute {
      root     = story_route
      prog "sewer_tunnel_graph" {
        route:str = "sewer_tunnel"
        location:str = "Sunken Tunnel"
        lockpick_skill:int = 0

        found_mark:bool =| lockpick_skill >= 2
        story_route:str =| route + ""
      }
    }

    ingress {
      to        = lockpick_skill
      from_ssot = party.skills.lockpick
    }

    egress {
      to   = story.route
      from = story_route
    }

    egress {
      to   = story.current_location
      from = location
    }

    egress {
      to   = story.flags.found_hidden_mark
      from = found_mark
    }

    next {
      compute {
        condition = always
        prog "to_hidden_archive" {
          always:bool = true
        }
      }
      action = hidden_archive
    }
  }

  action "campfire_wait" {
    compute {
      root     = story_route
      prog "campfire_wait_graph" {
        route:str = "campfire_wait"
        note:str = "waited_until_dawn"
        story_route:str =| route + ""
      }
    }

    egress {
      to   = story.route
      from = story_route
    }

    egress {
      to   = story.journal.latest
      from = note
    }

    egress {
      to           = story.current_location
      from_literal = "Crossroads Camp"
    }

    next {
      compute {
        condition = always
        prog "to_chapter_end_after_wait" {
          always:bool = true
        }
      }
      action = chapter_end
    }
  }

  action "shrine_discovery" {
    compute {
      root     = reward
      prog "shrine_discovery_graph" {
        relic:str = "Moon Sigil"
        reward:str =| relic + ""
      }
    }

    egress {
      to   = story.chapter_reward
      from = reward
    }

    egress {
      to           = story.current_location
      from_literal = "Ruined Shrine"
    }

    next {
      compute {
        condition = always
        prog "to_chapter_end_after_shrine" {
          always:bool = true
        }
      }
      action = chapter_end
    }
  }

  action "courtyard_arrival" {
    compute {
      root     = reward
      prog "courtyard_arrival_graph" {
        writ:str = "Guest Writ"
        reward:str =| writ + ""
      }
    }

    egress {
      to   = story.chapter_reward
      from = reward
    }

    egress {
      to           = story.current_location
      from_literal = "Castle Courtyard"
    }

    next {
      compute {
        condition = always
        prog "to_chapter_end_after_courtyard" {
          always:bool = true
        }
      }
      action = chapter_end
    }
  }

  action "hidden_archive" {
    compute {
      root     = reward
      prog "hidden_archive_graph" {
        ledger:str = "Old Kingdom Ledger"
        reward:str =| ledger + ""
      }
    }

    egress {
      to   = story.chapter_reward
      from = reward
    }

    egress {
      to           = story.current_location
      from_literal = "Hidden Archive"
    }

    next {
      compute {
        condition = always
        prog "to_chapter_end_after_archive" {
          always:bool = true
        }
      }
      action = chapter_end
    }
  }

  action "chapter_end" {
    compute {
      root     = chapter_result
      prog "chapter_end_graph" {
        prefix:str = "chapter_1_"
        suffix:str = "complete"
        chapter_result:str =| prefix + suffix
      }
    }

    egress {
      to           = story.chapter_state
      from_literal = "resolved"
    }

    egress {
      to   = story.result
      from = chapter_result
    }
  }
}
