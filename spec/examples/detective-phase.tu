state {
  crime_scene {
    disturbance_detected:bool = false
    visibility_score:number = 0
    camera_online:bool = false
    camera_timestamp_ok:bool = false
    last_search_area:str = ""
  }
  evidence {
    fingerprint_match:number = 0
    blood_trace:bool = false
    weapon_found:bool = false
    selected_tag:str = ""
  }
  witness {
    contradiction_detected:bool = false
    alibi_strength:number = 0
    statement:str = ""
  }
  leads {
    primary_suspect_name:str = ""
    confidence_score:number = 0
  }
  investigation {
    phase:str = ""
    last_note:str = ""
    scene_hotspot_found:bool = false
    critical_evidence_found:bool = false
    evidence_log:str = ""
    timeline_priority:bool = false
    interview_note:str = ""
    ready_to_identify_suspect:bool = false
    suspect_summary:str = ""
    case_file_ready:bool = false
    search_note:str = ""
    report_line:str = ""
    closed:bool = false
  }
}

scene "detective_evidence_hunt" {
  entry_actions     = [arrive_crime_scene]
  next_policy       = "first-match"

  overview at_least {
    arrive_crime_scene |=> scan_scene
    scan_scene |=> collect_physical_evidence
    scan_scene |=> interview_witness
    collect_physical_evidence |=> interview_witness
    interview_witness |=> analyze_timeline
    analyze_timeline |=> identify_suspect
    analyze_timeline |=> search_for_more_evidence
    identify_suspect |=> submit_case_file
    search_for_more_evidence |=> submit_case_file
  }

  action "arrive_crime_scene" {
    """
    Logic overview:
    - Initialize the investigation at the crime scene.
    - Set phase metadata and opening detective note.
    - Transition to scene scanning.
    """

    compute {
      prog "arrive_crime_scene_graph" {
        detective_note:str = "Scene secured. Start collecting clues." ~> @investigation.last_note
        |^| phase:str = "arrive_crime_scene" ~> @investigation.phase
      }
    }

    next {
      action = scan_scene
    }
  }

  action "scan_scene" {
    """
    Logic overview:
    - Read scene disturbance, visibility score, and camera status.
    - Determine whether the scene is ready for direct evidence collection.
    - Branch to collect evidence or proceed to witness interview.
    """

    compute {
      prog "scan_scene_graph" {
        disturbance_detected:bool <~ @crime_scene.disturbance_detected
        visibility_score:number <~ @crime_scene.visibility_score
        camera_online:bool <~ @crime_scene.camera_online

        clue_candidate:bool = disturbance_detected & camera_online
        search_ready:bool = visibility_score >= 3
        phase:str = "scan_scene" ~> @investigation.phase
        |^| scene_hotspot_found:bool = clue_candidate & search_ready ~> @investigation.scene_hotspot_found
      }
    }

    next {
      compute {
        prog "to_collect_physical_evidence" {
          scene_hotspot_found:bool <~ action(scene_hotspot_found)
          |?| go_collect:bool = scene_hotspot_found
        }
      }
      action = collect_physical_evidence
    }

    next {
      action = interview_witness
    }
  }

  action "collect_physical_evidence" {
    """
    Logic overview:
    - Read collected trace quality and selected evidence tag.
    - Determine whether critical evidence has been found.
    - Persist evidence log for downstream timeline analysis.
    """

    compute {
      prog "collect_physical_evidence_graph" {
        fingerprint_match:number <~ @evidence.fingerprint_match
        blood_trace:bool <~ @evidence.blood_trace
        weapon_found:bool <~ @evidence.weapon_found
        evidence_tag:str <~ @evidence.selected_tag

        fp_strong:bool = fingerprint_match >= 6
        trace_and_weapon:bool = blood_trace & weapon_found
        prefix:str = "Collected evidence: "
        evidence_log:str = prefix + evidence_tag ~> @investigation.evidence_log
        phase:str = "collect_physical_evidence" ~> @investigation.phase
        |^| critical_evidence_found:bool = fp_strong & trace_and_weapon ~> @investigation.critical_evidence_found
      }
    }

    next {
      action = interview_witness
    }
  }

  action "interview_witness" {
    """
    Logic overview:
    - Read witness statement and contradiction/alibi signals.
    - Mark timeline priority for deeper reconstruction.
    - Persist interview note and phase metadata.
    """

    compute {
      prog "interview_witness_graph" {
        contradiction_detected:bool <~ @witness.contradiction_detected
        alibi_strength:number <~ @witness.alibi_strength
        witness_statement:str <~ @witness.statement

        alibi_weak:bool = alibi_strength <= 3
        prefix:str = "Witness says: "
        interview_note:str = prefix + witness_statement ~> @investigation.interview_note
        phase:str = "interview_witness" ~> @investigation.phase
        |^| timeline_priority:bool = contradiction_detected & alibi_weak ~> @investigation.timeline_priority
      }
    }

    next {
      action = analyze_timeline
    }
  }

  action "analyze_timeline" {
    """
    Logic overview:
    - Read evidence and timeline readiness signals.
    - Decide whether there is enough support to identify a suspect.
    - Branch to suspect identification or extended evidence search.
    """

    compute {
      prog "analyze_timeline_graph" {
        critical_evidence_found:bool <~ @investigation.critical_evidence_found
        timeline_priority:bool <~ @investigation.timeline_priority
        camera_timestamp_ok:bool <~ @crime_scene.camera_timestamp_ok

        evidence_and_time:bool = critical_evidence_found & camera_timestamp_ok
        phase:str = "analyze_timeline" ~> @investigation.phase
        |^| ready_to_identify_suspect:bool = evidence_and_time & timeline_priority ~> @investigation.ready_to_identify_suspect
      }
    }

    next {
      compute {
        prog "to_identify_suspect" {
          ready_to_identify_suspect:bool <~ action(ready_to_identify_suspect)
          |?| go_identify:bool = ready_to_identify_suspect
        }
      }
      action = identify_suspect
    }

    next {
      action = search_for_more_evidence
    }
  }

  action "identify_suspect" {
    """
    Logic overview:
    - Read lead suspect identity and confidence score.
    - Generate suspect summary and case-file readiness.
    - Proceed to final submission.
    """

    compute {
      prog "identify_suspect_graph" {
        suspect_name:str <~ @leads.primary_suspect_name
        confidence_score:number <~ @leads.confidence_score

        high_confidence:bool = confidence_score >= 8
        prefix:str = "Primary suspect: "
        suspect_summary:str = prefix + suspect_name ~> @investigation.suspect_summary
        phase:str = "identify_suspect" ~> @investigation.phase
        |^| case_file_ready:bool = high_confidence ~> @investigation.case_file_ready
      }
    }

    next {
      action = submit_case_file
    }
  }

  action "search_for_more_evidence" {
    """
    Logic overview:
    - Record extended search area note when evidence is insufficient.
    - Mark case file as not ready yet.
    - Continue to final submission as pending investigation.
    """

    compute {
      prog "search_for_more_evidence_graph" {
        last_search_area:str <~ @crime_scene.last_search_area

        prefix:str = "Extended search area: "
        search_note:str = prefix + last_search_area ~> @investigation.search_note
        case_file_ready:bool = false ~> @investigation.case_file_ready
        |^| phase:str = "search_for_more_evidence" ~> @investigation.phase
      }
    }

    next {
      action = submit_case_file
    }
  }

  action "submit_case_file" {
    """
    Logic overview:
    - Read case-file readiness and suspect summary.
    - Emit a final investigation report line.
    - Persist final phase and closure flag.
    """

    compute {
      prog "submit_case_file_graph" {
        case_file_ready:bool <~ @investigation.case_file_ready
        suspect_summary:str <~ @investigation.suspect_summary

        prefix:str = "Filed report: "
        report_line:str = prefix + suspect_summary ~> @investigation.report_line
        phase:str = "submit_case_file" ~> @investigation.phase
        |^| investigation_closed:bool = case_file_ready ~> @investigation.closed
      }
    }

  }
}
