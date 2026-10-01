use scripting additions

on run argv
  if (count of argv) is not 1 then error "one app path required"
  set appPath to item 1 of argv
  set groups to {}
  set listGroups to {}
  set children to {}
  using terms from application "/Users/avi/Documents/apps/Things3.app"
    tell application appPath
      if not running then error "Things must already be running"
      set end of groups to {"todo", properties of every to do, id of every tag of every to do}
      set end of groups to {"project", properties of every project, id of every tag of every project}
      set end of groups to {"area", properties of every area, id of every tag of every area}
      set end of groups to {"tag", properties of every tag, {}}
      repeat with l in lists
        set end of listGroups to {id of l, properties of every to do of l, id of every tag of every to do of l}
      end repeat
      repeat with p in projects
        set end of children to {"project", id of p, properties of every to do of p, id of every tag of every to do of p}
      end repeat
      repeat with a in areas
        set end of children to {"area", id of a, properties of every to do of a, id of every tag of every to do of a}
      end repeat
    end tell
  end using terms from
  return {groups, listGroups, children}
end run
