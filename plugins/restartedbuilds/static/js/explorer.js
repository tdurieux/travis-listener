$.get('/r/restartedbuilds/api/jobs?limit=100').then(builds => {
    
    content_list = ''
    content_details = ''
    let count = 0
    for (let build of builds) {
        if (build.old.state == build.new.state) {
            continue;
        }
        count++
        content_list += '<a href="#list-' + build.id + '" class="list-group-item list-group-item-action"  id="list-' + build.id + '-list" data-toggle="list"  role="tab" aria-controls="' + build.id + '" data-job-id="' + build.id + '">\
        <div class="d-flex w-100 justify-content-between">\
          <h5 class="mb-1">' + build.old.state + ' ' + build.new.state + '</h5>\
          <small>' + build.id + '</small>\
        </div>\
        <p class="mb-1">' + build.old.language+'</p>\
      </a>';
      let analysis = ''
      if (build.log.analysis) {
        analysis = JSON.stringify(build.log.analysis.original, null, 2)
      }
      let diff = ''
      if (build.log.logDiff) {
          diff = build.log.logDiff.substring(build.log.logDiff.length - 2500)
      }
      content_details += '<div class="tab-pane fade" id="list-' + build.id + '" role="tabpanel" aria-labelledby="list-' + build.id + '-list"><button class="analyze btn" data-job-id="' + build.id + '">Analyze</button>' + analysis + '<pre>' + diff + '</pre></div>';
    }
    $('#restarted_builds_nb').text(count)

    $('#restarted_builds').html(content_list)
    $('#restarted_builds_details').html(content_details)

    $('.analyze.btn').on('click', function (e) {
        const id = e.target.getAttribute('data-job-id')
        $.get('/r/restartedbuilds/api/job/diff/' + id).then(log => {
            console.log(log.analysis.original)
        }, error => {
            console.error(error)
        })
    })
})