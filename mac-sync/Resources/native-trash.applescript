on receipt(resultState, resultReason, beforeValue, afterValue, hasAfter, cloudPolicy)
    set output to "{\"state\":\"" & resultState & "\""
    if resultReason is not "" then set output to output & ",\"reason\":\"" & resultReason & "\""
    if cloudPolicy then
        set output to output & ",\"observed_before\":{\"state\":\"value\",\"value\":" & beforeValue & "}"
        if hasAfter then set output to output & ",\"verified_after\":{\"state\":\"value\",\"value\":" & afterValue & "}"
    end if
    return output & "}"
end receipt

on run argv
    if (count argv) is not 5 then error "Invalid typed Trash request"
    set appPath to item 1 of argv
    set targetID to item 2 of argv
    set policy to item 3 of argv
    set baseValue to item 4 of argv
    set recovering to item 5 of argv
    if policy is not in {"cloud_wins", "things_wins"} or baseValue is not in {"true", "false"} or recovering is not in {"true", "false"} then error "Invalid typed Trash request"
    set cloudPolicy to policy is "cloud_wins"
    using terms from application id "com.culturedcode.ThingsMac"
        tell application appPath
            if not running then return "{\"state\":\"failed\",\"reason\":\"automation_denied\"}"
            try
                set alreadyTrashed to targetID is in (id of every to do of list id "TMTrashListSource")
                if alreadyTrashed then return my receipt("satisfied", "", "true", "true", true, cloudPolicy)
                if recovering is "true" and cloudPolicy then return my receipt("uncertain", "interrupted_delete", "false", "false", true, true)
                set targetTask to to do id targetID
                if targetID is in (id of every to do of list id "TMLogbookListSource") then set targetTask to to do id targetID of list id "TMLogbookListSource"
                if id of targetTask is not targetID then return "{\"state\":\"skipped\",\"reason\":\"target_unavailable\"}"
            on error
                return "{\"state\":\"failed\",\"reason\":\"automation_denied\"}"
            end try
            if not cloudPolicy and baseValue is not "false" then return "{\"state\":\"skipped\",\"reason\":\"things_changed\"}"
            try
                move targetTask to list id "TMTrashListSource"
                set verified to targetID is in (id of every to do of list id "TMTrashListSource")
                if verified then return my receipt("applied", "", "false", "true", true, cloudPolicy)
                return my receipt("uncertain", "verification_failed", "false", "false", true, cloudPolicy)
            on error
                return my receipt("uncertain", "verification_failed", "false", "false", false, cloudPolicy)
            end try
        end tell
    end using terms from
end run
