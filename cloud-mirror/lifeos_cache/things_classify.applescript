use framework "Foundation"
use scripting additions

-- Public dictionary terms only. This installation's verified app path is used
-- for terminology; the actual target path is passed as a structured argument.
on run argv
  if (count of argv) is not 1 then error "one app path required"
  set appPath to item 1 of argv
  set classificationRows to {}
  using terms from application "/Users/avi/Documents/apps/Things3.app"
    tell application appPath
      if not running then error "Things must already be running"
      repeat with t in to dos
        set end of classificationRows to {id of t, class of t as text}
      end repeat
      repeat with p in projects
        set end of classificationRows to {id of p, "project"}
        repeat with t in to dos of p
          set end of classificationRows to {id of t, class of t as text}
        end repeat
      end repeat
      repeat with a in areas
        repeat with t in to dos of a
          set end of classificationRows to {id of t, class of t as text}
        end repeat
      end repeat
      repeat with l in lists
        repeat with t in to dos of l
          set end of classificationRows to {id of t, class of t as text}
        end repeat
      end repeat
      if (count of classificationRows) > 50000 then error "classification safety budget exceeded"
    end tell
  end using terms from
  set jsonData to current application's NSJSONSerialization's |dataWithJSONObject:options:error:|(classificationRows, 0, missing value)
  return (current application's NSString's alloc()'s |initWithData:encoding:|(jsonData, 4)) as text
end run
